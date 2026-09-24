import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, validationError } from "@/lib/api/errors";
import { deletePerson, reasonSchema } from "@/lib/people/delete-service";
import { getPersonDetail, updatePerson } from "@/lib/people/detail-service";
import { personUpdateSchema } from "@/lib/validation/person";

// GET /api/people/:id — spec §7 detail with timeline.
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/people/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const { id } = await ctx.params;
  const result = await getPersonDetail(id, viewer);
  if (result.kind === "not_found")
    return apiError(
      404,
      "not_found",
      "This person doesn't exist or was removed.",
    );
  if (result.kind === "forbidden")
    return apiError(403, "forbidden", "You don't have access to this person.");
  return Response.json(result.detail);
}

// DELETE /api/people/:id — soft delete, super_admin only, reason required.
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (viewer.role !== "super_admin")
    return apiError(403, "forbidden", "Only a super admin can delete people.");

  const parsed = reasonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await deletePerson(id, parsed.data.reason, viewer);
  switch (result.kind) {
    case "done":
      return new Response(null, { status: 204 });
    case "forbidden":
      return apiError(
        403,
        "forbidden",
        "Only a super admin can delete people.",
      );
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This person doesn't exist or was removed.",
      );
    case "conflict":
      return apiError(409, "delete_blocked", result.message);
  }
}

// PATCH /api/people/:id — spec §7 partial update, audit-logged, with the
// If-Match stale-edit check.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const loadedUpdatedAt = request.headers.get("If-Match");
  if (!loadedUpdatedAt)
    return apiError(
      428,
      "precondition_required",
      "Reload this person and try again.",
    );

  const body = await request.json().catch(() => null);
  const parsed = personUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updatePerson(id, parsed.data, loadedUpdatedAt, viewer);

  switch (result.kind) {
    case "updated":
      return Response.json(result.person);
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This person doesn't exist or was removed.",
      );
    case "forbidden":
      return apiError(
        403,
        "forbidden",
        "You don't have access to edit this person.",
      );
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this person while you were editing. Reload to see their version.",
      );
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        {
          fields: result.fields,
        },
      );
    case "duplicate": {
      const what = result.on === "phone" ? "phone number" : "email";
      const name = result.existing.fullName || "another person";
      return apiError(
        409,
        "duplicate",
        `This ${what} already belongs to ${name}. Open their record, or merge them.`,
        {
          fields: { [result.on]: `Already belongs to ${name}` },
          existing: result.existing,
        },
      );
    }
  }
}
