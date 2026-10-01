import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { erasePerson, reasonSchema } from "@/lib/people/delete-service";

// POST /api/people/:id/erase — spec §7 / §12.10 PDPA anonymise.
// super_admin only, on the person's request, irreversible.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/erase">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (viewer.role !== "super_admin")
    return forbidden(viewer, request, {
      what: "erase people",
      resource: "person",
    });

  const parsed = reasonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await erasePerson(id, parsed.data.reason, viewer);
  switch (result.kind) {
    case "done":
      return new Response(null, { status: 204 });
    case "forbidden":
      return forbidden(viewer, request, {
        what: "erase people",
        resource: "person",
      });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This person doesn't exist or was removed.",
      );
    case "conflict":
      return apiError(409, "erase_blocked", result.message);
  }
}
