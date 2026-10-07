import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { getEnrolment } from "@/lib/enrolments/service";

// GET /api/enrolments/:id — one enrolment for §9.11, including the `version`
// every write sends back as If-Match (§7). Readable by the five roles on the
// §6 enrolment row; marketing and part_time have no access at all, and their
// denial is audit-logged like any other (§6).
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/enrolments/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "enrolment", "read").allowed)
    return forbidden(viewer, request, {
      what: "enrolments",
      resource: "enrolment",
    });

  const { id } = await ctx.params;
  const found = await getEnrolment(id, viewer);
  if (!found)
    return apiError(404, "not_found", "This enrolment doesn't exist.");
  return Response.json(found);
}
