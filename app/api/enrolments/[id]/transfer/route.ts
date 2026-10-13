import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteEnrolment } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { transferEnrolment } from "@/lib/enrolments/service";
import { enrolmentWriteResponse } from "@/lib/enrolments/write-response";
import { enrolmentTransferSchema } from "@/lib/validation/enrolment";

// POST /api/enrolments/:id/transfer — §9.11, §7.1. Its own action, like the
// class cancel: the new enrolment, the source row and the §11.1 event move
// together, and the target class's seats are checked under its row lock.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/enrolments/[id]/transfer">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteEnrolment(viewer))
    return forbidden(viewer, request, {
      what: "transfer enrolments",
      resource: "enrolment",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this enrolment and try again.",
    );

  const parsed = enrolmentTransferSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await transferEnrolment(id, parsed.data, ifMatch, viewer);
  return enrolmentWriteResponse(result, viewer, request, "transfer enrolments");
}
