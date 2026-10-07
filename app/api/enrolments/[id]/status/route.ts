import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteEnrolment } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { changeEnrolmentStatus } from "@/lib/enrolments/service";
import { enrolmentWriteResponse } from "@/lib/enrolments/write-response";
import { enrolmentStatusSchema } from "@/lib/validation/enrolment";

// POST /api/enrolments/:id/status — §9.11, §7.1, §12.4. The §12.4 check is the
// server's: the screen offers only the legal moves, and this refuses anything
// else with 422 whatever the screen did.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/enrolments/[id]/status">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteEnrolment(viewer))
    return forbidden(viewer, request, {
      what: "change enrolments",
      resource: "enrolment",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this enrolment and try again.",
    );

  const parsed = enrolmentStatusSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await changeEnrolmentStatus(id, parsed.data, ifMatch, viewer);
  return enrolmentWriteResponse(result, viewer, request, "change enrolments");
}
