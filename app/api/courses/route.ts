import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCourse, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { createCourse, listCourses } from "@/lib/courses/service";
import {
  courseCreateSchema,
  courseListQuerySchema,
} from "@/lib/validation/course";

// GET /api/courses — spec §7 (v1.6): the course catalogue, readable by
// every role on the §6 course row. Used by the 9.5 course filter (all
// courses), deal course pickers (`?active=true`) and the 9.7 screen.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "class", "read").allowed)
    return forbidden(viewer, request, { what: "courses", resource: "course" });

  const sp = request.nextUrl.searchParams;
  const parsed = courseListQuerySchema.safeParse({
    active: sp.get("active") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listCourses(parsed.data));
}

// POST /api/courses — spec §7 / §9.7 create. super_admin and operations
// only (§6 course row). A taken code is a 409 naming the holder, so nobody
// makes a second record for a course that is only retired.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCourse(viewer))
    return forbidden(viewer, request, {
      what: "add courses",
      resource: "course",
    });

  const parsed = courseCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await createCourse(parsed.data, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json(
        { id: result.id, version: result.version },
        { status: 201 },
      );
    case "duplicate":
      return apiError(
        409,
        "duplicate_code",
        `Course code ${result.code} already belongs to ${result.nameEn}. Edit that course instead — reactivate it if it was retired.`,
        { fields: { code: `Already used by ${result.nameEn}` } },
      );
    default:
      return forbidden(viewer, request, {
        what: "add courses",
        resource: "course",
      });
  }
}
