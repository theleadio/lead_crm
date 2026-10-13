import type { NextRequest } from "next/server";
import { createClass, listClasses } from "@/lib/classes/service";
import { classWriteResponse } from "@/lib/classes/write-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import {
  classListQuerySchema,
  readClassParams,
} from "@/lib/validation/class-query";
import { classCreateSchema } from "@/lib/validation/class";

// GET /api/classes — spec §7: the schedule with seat counts (§12.1),
// readable by every role on the §6 course/class row. Upcoming classes by
// default; `when=past` for finished ones (§9.8). Read-only route.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "class", "read").allowed)
    return forbidden(viewer, request, { what: "classes", resource: "class" });

  const parsed = classListQuerySchema.safeParse(
    readClassParams(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid list filters.");

  return Response.json(await listClasses(parsed.data, viewer));
}

// POST /api/classes — spec §7 / §9.9 create. super_admin and operations only
// (§6 course/class row). The class lands as a draft: publishing is its own
// action, so nothing reaches the website by accident.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "add classes",
      resource: "class",
    });

  const parsed = classCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await createClass(parsed.data, viewer);
  return classWriteResponse(result, viewer, request, "add classes", 201);
}
