import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteEnrolment, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listEnrolments } from "@/lib/enrolments/list";
import { createEnrolment } from "@/lib/enrolments/service";
import { enrolmentWriteResponse } from "@/lib/enrolments/write-response";
import { enrolmentCreateSchema } from "@/lib/validation/enrolment";
import {
  enrolmentListQuerySchema,
  readEnrolmentParams,
} from "@/lib/validation/enrolment-query";

// GET /api/enrolments — §7 list conventions, the §9.11 list screen. Readable by
// the five roles on the §6 enrolment row; marketing and part_time get an
// audited 403, the same as the detail route.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "enrolment", "read").allowed)
    return forbidden(viewer, request, {
      what: "enrolments",
      resource: "enrolment",
    });

  const parsed = enrolmentListQuerySchema.safeParse(
    readEnrolmentParams(request.nextUrl.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listEnrolments(parsed.data, viewer));
}

// POST /api/enrolments — §7.1, §9.11. The Add control on the §9.10 Roster.
// The price is read from the class on the server (§8.3), and `confirmed` is
// not a status a create may ask for: a payment (§9.12) or a status change
// gets an enrolment there.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteEnrolment(viewer))
    return forbidden(viewer, request, {
      what: "add enrolments",
      resource: "enrolment",
    });

  const parsed = enrolmentCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await createEnrolment(parsed.data, viewer);
  return enrolmentWriteResponse(result, viewer, request, "add enrolments");
}
