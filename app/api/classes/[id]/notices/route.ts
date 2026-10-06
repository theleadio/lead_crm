import type { NextRequest } from "next/server";
import { listClassNotices } from "@/lib/classes/notices";
import { getClass } from "@/lib/classes/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";

// GET /api/classes/:id/notices — §7.1, §9.10. Pending first, then newest
// first. Readable by every role that reads the class (§6 course/class row):
// seeing that students have not been told yet is not a write.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/notices">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "class", "read").allowed)
    return forbidden(viewer, request, { what: "classes", resource: "class" });

  const { id } = await ctx.params;
  // A class with no notices is an empty list; an id with no class is a 404.
  const found = await getClass(id, viewer);
  if (!found) return apiError(404, "not_found", "This class doesn't exist.");
  return Response.json({ data: await listClassNotices(id, viewer) });
}
