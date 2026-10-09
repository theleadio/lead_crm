import type { ManualPaymentMethod } from "../validation/payment.ts";

// What `POST /api/payments/manual` answers with, and what the §9.12 modal
// turns into its success state. The amount stays a decimal string (§4, §12.7),
// and `statusMoved` is what lets the message say whether the enrolment is now
// confirmed instead of guessing (§9.12 "Success state names what changed").
export type RecordedPayment = {
  paymentId: string;
  enrolmentId: string;
  method: ManualPaymentMethod;
  amountMyr: string;
  // The enrolment's version after the save, so the screen's next write has a
  // current If-Match (`record-concurrency`).
  version: number;
  // False for a late payment on an already-confirmed student, which §9.12
  // records without touching the status.
  statusMoved: boolean;
  status: string;
};
