// Spec §12.4, the enrolment state machine, as one table. Both the screen's
// control and the API's check read it, so the screen can never offer a move
// the API refuses, and §12.4 is in one place rather than in two if-chains.

export const ENROLMENT_STATUSES = [
  "reserved",
  "payment_pending",
  "waitlisted",
  "confirmed",
  "onboarded",
  "attended",
  "completed",
  "no_show",
  "transferred",
  "cancelled",
  "refunded",
] as const;

export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

// Word for word the §12.4 diagram. A status missing from a row's list is a
// 422, including the status the row already holds — §12.4 has no self-arrow,
// and a "change" to the current status is a mistake, not a no-op.
const NEXT: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  reserved: ["payment_pending", "confirmed", "waitlisted", "cancelled"],
  payment_pending: ["confirmed", "cancelled"],
  waitlisted: ["reserved"],
  confirmed: ["onboarded", "transferred", "cancelled"],
  // v1.10: a student can withdraw after their onboarding messages went out,
  // and a class cancel reaches them too. `attended`, `completed` and `no_show`
  // are history and never move to cancelled.
  onboarded: ["attended", "cancelled", "no_show"],
  attended: ["completed"],
  completed: [],
  no_show: [],
  // Reached by the transfer action, which writes both rows itself (§9.11).
  transferred: [],
  cancelled: ["refunded"],
  refunded: [],
};

export function nextStatuses(status: string): EnrolmentStatus[] {
  return NEXT[status as EnrolmentStatus] ?? [];
}

// `transferred` is on the §12.4 diagram but is not a status anyone sets on its
// own: §5 refuses a transferred row that does not name the enrolment it became,
// so the transfer action writes both rows (§9.11). The status control and the
// status route share this list, so neither offers nor accepts that move.
const ACTION_ONLY: EnrolmentStatus[] = ["transferred"];

export function statusMoves(status: string): EnrolmentStatus[] {
  return nextStatuses(status).filter((s) => !ACTION_ONLY.includes(s));
}

export function canChangeTo(from: string, to: string): boolean {
  return statusMoves(from).includes(to as EnrolmentStatus);
}

// §12.4 gives `confirmed → transferred` and no other arrow into it, so only a
// confirmed student can be moved to another class. A payment_pending HRDC
// student or an onboarded one asking to move is a question for Shawn (the
// proposal's open question 2), not a quiet exception here.
export function canTransfer(status: string): boolean {
  return status === "confirmed";
}

// §12.4: the statuses a transfer may be offered from, kept beside the rule so
// a reader sees both at once.
export const TRANSFERABLE_FROM = "confirmed";
