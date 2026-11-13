// Spec §5 `enquiry`, as the §9.13 queue reads it. The status list is the
// CHECK constraint (migration 019 added `waiting_customer`), word for word,
// so a value the database would refuse is a type error here first.

export const ENQUIRY_STATUSES = [
  "open",
  "waiting_customer",
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
  waiting_customer: "secondary",
  ai_resolved: "success",
  human_resolved: "success",
  converted: "success",
  closed: "secondary",
};

// Still being worked: the queue's default view, and the only statuses that
// can be past their deadline.
export const ACTIVE_STATUSES = ["open", "waiting_customer"] as const;
export const isActiveStatus = (s: EnquiryStatus) =>
  (ACTIVE_STATUSES as readonly string[]).includes(s);

// Since migration 019 a category is a row of `enquiry_category` (a code, its
// labels and its team), edited in Settings, so it is a string here. The ten
// §5 codes are still seeded.
export type EnquiryCategory = string;
export const CATEGORY_CODE = /^[a-z][a-z0-9_]{1,30}$/;

export const ENQUIRY_PRIORITIES = ["low", "normal", "high"] as const;
export type EnquiryPriority = (typeof ENQUIRY_PRIORITIES)[number];

// `enquiry.channel` has no CHECK and §5 lists no values for it, so the filter
// takes the one channel enumeration §5 does give, the touchpoint's, plus the
// inbox's channels (migration 019) and `phone` for one made by hand. The WATI
// intake (§11.2) writes `whatsapp` or `ctwa`; the rest cost nothing to allow.
export const ENQUIRY_CHANNELS = [
  "web_form",
  "whatsapp",
  "ctwa",
  "email",
  "messenger",
  "instagram",
  "phone",
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
  // E-000123 (migration 019): the reference a customer is given.
  number: string;
  // Free text about a person; erase clears it. Null on WATI enquiries until
  // someone writes one.
  subject: string | null;
  // Integer row version (migration 005); every write sends it as If-Match.
  version: number;
  personId: string;
  // §11.2: a WhatsApp-only person has no name, so the phone stands in.
  personName: string;
  // Free text in the table, so read as the database has it.
  channel: string;
  category: EnquiryCategory | null;
  categoryLabel: string | null;
  teamId: string;
  teamName: string;
  priority: EnquiryPriority;
  status: EnquiryStatus;
  assignedUserId: string | null;
  assigneeName: string | null;
  firstMessageAt: string | null;
  firstResponseAt: string | null;
  // Minutes since COALESCE(first_message_at, created_at), decided by the
  // database's clock (design: one waiting time for the column, the order, the
  // sort and the SLA).
  waitedMinutes: number;
  // The first-reply deadline (lib/enquiries/deadline.ts). Null for an
  // enquiry written before migration 019 or by a writer that set none.
  slaDueAt: string | null;
  pastSla: boolean;
  // Set once converted (§5 CHECK), so the screen can link the deal.
  dealId: string | null;
};

export type { EnquiryListQuery } from "../validation/enquiry-query.ts";
