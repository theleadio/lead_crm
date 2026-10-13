import type { NextRequest } from "next/server";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canRecordPayment, recordManualPayment } from "@/lib/payments/service";
import { paymentWriteResponse } from "@/lib/payments/write-response";
import { paymentManualSchema } from "@/lib/validation/payment";

// POST /api/payments/manual — §7, §9.12. The only route in the app that
// creates a `payment` row (§4 rule 4). It carries the enrolment's `version` as
// If-Match, because the save can move that enrolment to `confirmed`.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canRecordPayment(viewer))
    return forbidden(viewer, request, {
      what: "record payments",
      resource: "payment",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this enrolment and try again.",
    );

  const parsed = paymentManualSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await recordManualPayment(parsed.data, ifMatch, viewer);
  return paymentWriteResponse(result, viewer, request);
}
