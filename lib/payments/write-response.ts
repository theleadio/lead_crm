import { apiError, forbidden } from "../api/errors.ts";
import type { Viewer } from "../auth/permissions.ts";
import { enumLabel } from "../classes/types.ts";
import { formatMegabytes, MAX_PROOF_BYTES } from "../uploads/verify.ts";
import type { PaymentWriteResult } from "./service.ts";

// One place that turns a §9.12 save result into its §7 status code, as
// `lib/enrolments/write-response.ts` does for the §9.11 writes. Every message
// follows §13: say what happened and what to do next, and never show a
// database error — §9.12 is explicit that a repeat submit reads "already
// recorded", not an error page.

export async function paymentWriteResponse(
  result: PaymentWriteResult,
  viewer: Viewer,
  request: Request,
): Promise<Response> {
  switch (result.kind) {
    case "ok":
      return Response.json(result.payment, { status: 201 });
    case "forbidden":
      return forbidden(viewer, request, {
        what: "record payments",
        resource: "payment",
      });
    case "not_found":
      return apiError(404, "not_found", "This enrolment doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this enrolment while you were reading it. Reload to see their version.",
      );
    // §9.12: money is not recorded against a cancelled, refunded or
    // transferred enrolment. The message names the status that refused it.
    case "blocked_status":
      return apiError(
        422,
        "blocked_status",
        `This enrolment is ${enumLabel(result.status).toLowerCase()}, so a payment can't be recorded against it. Record it on the enrolment the student actually holds.`,
      );
    // §12.1: confirming would oversell — the reservation had run out.
    case "no_seats":
      return apiError(
        409,
        "no_seats",
        `${result.classCode} has no seats left, so this payment can't confirm the place. Free a seat in it, or move the student to another class first.`,
      );
    // Migration 008. This is a double-click or a retry, so it reads as work
    // already done rather than as a failure (§9.12 One proof, one payment).
    case "already_recorded":
      return apiError(
        409,
        "already_recorded",
        "This payment is already recorded. Reload the enrolment to see it.",
      );
    case "proof_not_yours":
      return apiError(
        400,
        "proof_not_yours",
        "That proof belongs to a different enrolment. Attach the file again.",
      );
    case "proof_missing":
      return apiError(
        400,
        "proof_missing",
        "The proof didn't finish uploading. Attach the file again.",
        { fields: { proofKey: "Attach the payment proof" } },
      );
    case "proof_rejected":
      return apiError(400, "proof_rejected", proofMessage(result.check), {
        fields: { proofKey: proofMessage(result.check) },
      });
  }
}

// §13: "That file is 14MB. The limit is 10MB — try a photo instead of a scan."
function proofMessage(
  check: Extract<PaymentWriteResult, { kind: "proof_rejected" }>["check"],
): string {
  switch (check.reason) {
    case "too_large":
      return `That file is ${formatMegabytes(check.bytes)}. The limit is ${formatMegabytes(MAX_PROOF_BYTES)} — try a photo instead of a scan.`;
    case "empty":
      return "That file is empty. Attach the proof again.";
    case "unsupported_type":
      return "That file isn't an image or a PDF. Attach a photo of the slip or a PDF.";
  }
}
