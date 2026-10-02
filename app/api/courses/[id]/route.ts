import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCourse } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { updateCourse } from "@/lib/courses/service";
import { courseUpdateSchema } from "@/lib/validation/course";

// PATCH /api/courses/:id — spec §7 / §9.7 partial update under the v1.7
// If-Match stale-edit contract. Retiring a course is `isActive: false` here,
// not a separate endpoint: it changes nothing but the flag.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/courses/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCourse(viewer))
    return forbidden(viewer, request, {
      what: "edit courses",
      resource: "course",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this course and try again.",
    );

  const parsed = courseUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateCourse(id, parsed.data, ifMatch, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json({ id: result.id, version: result.version });
    case "not_found":
      return apiError(404, "not_found", "This course doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this course while you were editing. Reload to see their version.",
      );
    case "duplicate":
      return apiError(
        409,
        "duplicate_code",
        `Course code ${result.code} already belongs to ${result.nameEn}.`,
        { fields: { code: `Already used by ${result.nameEn}` } },
      );
    case "forbidden":
      return forbidden(viewer, request, {
        what: "edit courses",
        resource: "course",
      });
  }
}
