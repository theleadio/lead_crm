// Shapes and display rules for classes (spec §5 `class`, §9.8, §12.1). Pure
// data — no database import — so both server and client components can use it.

// §5 `class_status`. The list reports the stored value and never recomputes
// it: §12.1 derives status in the database, and draft, cancelled and
// completed are set by people and override the seat-derived ones.
export const CLASS_STATUSES = [
  "draft",
  "open",
  "few_seats",
  "full",
  "cancelled",
  "completed",
] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const CLASS_LANGUAGES = ["en", "zh"] as const;
export type ClassLanguage = (typeof CLASS_LANGUAGES)[number];

export const CLASS_MODES = ["in_person", "online", "hybrid"] as const;
export type ClassMode = (typeof CLASS_MODES)[number];

// One row of the §9.8 list. No `online_url` (§5: never shown publicly) and no
// price — the list shows neither.
export type ClassListItem = {
  id: string;
  code: string;
  courseId: string;
  courseName: string;
  // ISO dates and HH:MM times, formatted by the database so no JS `Date`
  // touches them (§4).
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  language: ClassLanguage;
  mode: ClassMode;
  venueName: string | null;
  city: string | null;
  capacity: number;
  // §12.1, split: confirmed-and-beyond, then live reservations.
  confirmedCount: number;
  reservedCount: number;
  seatsAvailable: number;
  status: string;
  isPublic: boolean;
  // Integer row version (migration 005); 9.9 sends it back as If-Match (§7).
  version: number;
};

type BadgeVariant =
  "default" | "secondary" | "success" | "warning" | "destructive";

// §9.8 status colours: draft grey, open green, few_seats amber, full blue,
// cancelled red, completed grey. The label carries the meaning too, so the
// colour is never the only signal.
export const CLASS_STATUS_BADGE: Record<
  ClassStatus,
  { label: string; variant: BadgeVariant }
> = {
  draft: { label: "Draft", variant: "secondary" },
  open: { label: "Open", variant: "success" },
  few_seats: { label: "Few seats", variant: "warning" },
  full: { label: "Full", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  completed: { label: "Completed", variant: "secondary" },
};

// A status the screen doesn't know is shown as plain text rather than
// breaking the row.
export function classStatusBadge(status: string) {
  return (
    CLASS_STATUS_BADGE[status as ClassStatus] ?? {
      label: status,
      variant: "secondary" as const,
    }
  );
}

export function seatBarColor(status: string): string {
  if (status === "full") return "bg-primary";
  if (status === "few_seats") return "bg-warning";
  if (status === "cancelled") return "bg-ink-subtle";
  return "bg-success";
}

// One roster row on the 9.10 Roster tab (§9.10, §5 `enrolment`). No phone and
// no email: the tab shows who is in the class, not how to reach them, and
// marketing has no enrolment read at all (§6).
export type RosterRow = {
  id: string;
  personId: string;
  // §11.2: a WhatsApp-only person has no name, so the phone stands in.
  personName: string;
  status: string;
  payerType: string;
  bookerName: string | null;
  pricePaidMyr: string | null;
  seatReservedUntil: string | null;
  createdAt: string;
  // §12.1, decided by the one seat predicate rather than by reading `status`
  // again on screen (design 3).
  holdsSeat: boolean;
};

// One notice on the 9.10 Notices tab (§5 `class_notice`, §7.1). `sentAt` and
// `sendError` are Shawn's worker's columns (§12.11) — read here, never written.
export type ClassNoticeRecord = {
  id: string;
  status: string;
  changedFields: Record<string, { from: string | null; to: string | null }>;
  messageEn: string | null;
  messageZh: string | null;
  recipientCount: number;
  createdByName: string | null;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  sendError: string | null;
};

// An enum value as a label: "payment_pending" reads "Payment pending". One
// formatter beats a map per column, and a value the screen doesn't know
// still reads as words (§13).
export function enumLabel(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
