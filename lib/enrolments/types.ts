import type { EnrolmentStatus } from "./status-rules.ts";

// Spec §9.11 Enrolment detail: one person's place in one class, as the screen
// reads it. Money stays a decimal string (§4, §12.7) — `price_paid_myr` is the
// snapshot taken at purchase, never the class's current price.

export type EnrolmentPaymentRow = {
  id: string;
  method: string;
  amountMyr: string;
  status: string;
  paidAt: string | null;
};

export type EnrolmentDetail = {
  id: string;
  // Integer row version (migration 005); every write sends it as If-Match.
  version: number;
  status: EnrolmentStatus;
  payerType: string;
  personId: string;
  // §11.2: a WhatsApp-only person has no name, so the phone stands in.
  personName: string;
  bookerPersonId: string | null;
  bookerName: string | null;
  dealId: string | null;
  classId: string;
  classCode: string;
  courseName: string;
  classStartDate: string;
  classEndDate: string;
  classCourseId: string;
  classStatus: string;
  // §12.1, the database's numbers, never recomputed on screen.
  capacity: number;
  confirmedCount: number;
  reservedCount: number;
  seatsAvailable: number;
  pricePaidMyr: string | null;
  onboardingStep: number;
  certificateNo: string | null;
  seatReservedUntil: string | null;
  cancelledReason: string | null;
  completedAt: string | null;
  // Set when the status is `transferred` (§5), so the screen can follow it.
  transferredToEnrolmentId: string | null;
  transferredToClassCode: string | null;
  createdAt: string;
  // §6 payment row: null when the viewer may not read payments at all, so an
  // empty list and no access read differently on screen.
  payments: EnrolmentPaymentRow[] | null;
};

// One row of the enrolments list (§9.11 list, §7 `{ data, page }`). Narrower
// than EnrolmentDetail on purpose: a table view never eager-loads whole
// relations (§7), so there is no payment, no booker and no onboarding here.
export type EnrolmentListItem = {
  id: string;
  personId: string;
  // §11.2: a WhatsApp-only person has no name, so the phone stands in.
  personName: string;
  classId: string;
  classCode: string;
  courseName: string;
  classStartDate: string;
  classEndDate: string;
  status: EnrolmentStatus;
  // §12.1, decided by the one seat predicate rather than by reading `status`
  // again on screen.
  holdsSeat: boolean;
  payerType: string;
  pricePaidMyr: string | null;
  createdAt: string;
};

type BadgeVariant =
  "default" | "secondary" | "success" | "warning" | "destructive";

// The §12.4 statuses as colours, shared by the §9.11 detail header and the
// list, so a status never reads green on one screen and grey on the other.
// The label carries the meaning too, so the colour is never the only signal
// (§13).
export const ENROLMENT_STATUS_BADGE: Record<string, BadgeVariant> = {
  reserved: "warning",
  payment_pending: "warning",
  waitlisted: "secondary",
  confirmed: "success",
  onboarded: "success",
  attended: "success",
  completed: "default",
  no_show: "destructive",
  transferred: "secondary",
  cancelled: "destructive",
  refunded: "destructive",
};

// One option in the transfer picker (§9.11): the class, and whether it has
// room. Built from the §9.8 list read, so the seat numbers are §12.1's.
export type TransferTarget = {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  seatsAvailable: number;
  capacity: number;
};
