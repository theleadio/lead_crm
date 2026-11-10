// Spec §5 `enquiry`, as the §9.13 queue reads it. The status and category
// lists are the CHECK constraints of migration 001, word for word, so a value
// the database would refuse is a type error here first.

export const ENQUIRY_STATUSES = [
  "open",
  "ai_resolved",
  "human_resolved",
  "converted",
  "closed",
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

// Status as a badge colour, like ENROLMENT_STATUS_BADGE. The label carries the
// meaning too, so colour is never the only signal (§13).
export const ENQUIRY_STATUS_BADGE: Record<
  EnquiryStatus,
  "default" | "secondary" | "success"
> = {
  open: "default",
  ai_resolved: "success",
  human_resolved: "success",
  converted: "success",
  closed: "secondary",
};

export const ENQUIRY_CATEGORIES = [
  "course_info",
  "schedule",
  "price",
  "hrdc",
  "corporate",
  "registration_help",
  "payment_issue",
  "post_class",
  "complaint",
  "other",
] as const;
export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number];

// `enquiry.channel` has no CHECK and §5 lists no values for it, so the filter
// takes the one channel enumeration §5 does give, the touchpoint's. The WATI
// intake (§11.2) writes `whatsapp` or `ctwa`; the rest cost nothing to allow.
export const ENQUIRY_CHANNELS = [
  "web_form",
  "whatsapp",
  "ctwa",
  "lead_form",
  "walk_in",
  "referral",
  "payment_link",
  "import",
] as const;

// The two outcomes a member of staff may close with. `ai_resolved` is written
// only by Shawn's side, and `converted` needs a deal (§5 CHECK).
export const ENQUIRY_CLOSE_STATUSES = ["human_resolved", "closed"] as const;

// One row of the queue (§9.13, §7 `{ data, page }`). No phone or email: the
// contact details belong in the context panel, not in a column.
export type EnquiryRow = {
  id: string;
  // Integer row version (migration 005); every write sends it as If-Match.
  version: number;
  personId: string;
  // §11.2: a WhatsApp-only person has no name, so the phone stands in.
  personName: string;
  // Free text in the table, so read as the database has it.
  channel: string;
  category: EnquiryCategory | null;
  status: EnquiryStatus;
  assignedUserId: string | null;
  assigneeName: string | null;
  firstMessageAt: string | null;
  firstResponseAt: string | null;
  // Minutes since COALESCE(first_message_at, created_at), decided by the
  // database's clock (design: one waiting time for the column, the order, the
  // sort and the SLA).
  waitedMinutes: number;
  pastSla: boolean;
  // Set once converted (§5 CHECK), so the screen can link the deal.
  dealId: string | null;
};

export type { EnquiryListQuery } from "../validation/enquiry-query.ts";
