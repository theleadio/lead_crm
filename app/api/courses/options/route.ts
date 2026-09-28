import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { listCourseOptions } from "@/lib/deals/service";

// GET /api/courses/options — {id, name} of active courses for the 9.5
// course filter, for every role that can read deals. Not in §7 yet
// (raised with Shawn); replaced by GET /api/courses when 9.7 lands.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "deal", "read").allowed)
    return forbidden(viewer, request, { what: "courses", resource: "course" });
  return Response.json({ data: await listCourseOptions() });
}
