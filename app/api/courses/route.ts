import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listCourses } from "@/lib/courses/service";
import { courseListQuerySchema } from "@/lib/validation/course";

// GET /api/courses — spec §7 (v1.6): the course catalogue, readable by
// every role on the §6 course row. Used by the 9.5 course filter (all
// courses) and deal course pickers (`?active=true`). POST/PATCH come with
// 9.7.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "class", "read").allowed)
    return forbidden(viewer, request, { what: "courses", resource: "course" });

  const sp = request.nextUrl.searchParams;
  const parsed = courseListQuerySchema.safeParse({
    active: sp.get("active") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listCourses(parsed.data));
}
