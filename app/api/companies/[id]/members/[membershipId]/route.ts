import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany } from "@/lib/auth/permissions";
import { apiError, validationError } from "@/lib/api/errors";
import { updateMembership } from "@/lib/companies/service";
import { membershipUpdateSchema } from "@/lib/validation/company";

const noAccess = () =>
  apiError(403, "forbidden", "You don't have access to edit companies.");

// PATCH /api/companies/:id/members/:membershipId — spec §7.1 (v1.5). Edit
// job title and HR/billing flags, or end the membership with `endDate`.
// Rows are never deleted; ending is one-way.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/companies/[id]/members/[membershipId]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer)) return noAccess();

  const parsed = membershipUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id, membershipId } = await ctx.params;
  const result = await updateMembership(id, membershipId, parsed.data, viewer);
  switch (result.kind) {
    case "ok":
      return new Response(null, { status: 204 });
    case "forbidden":
      return noAccess();
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This membership doesn't exist or was removed.",
      );
    case "already_ended":
      return apiError(
        409,
        "already_ended",
        "This person has already left the company. To rejoin, add them again.",
      );
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        { fields: result.fields },
      );
  }
}
