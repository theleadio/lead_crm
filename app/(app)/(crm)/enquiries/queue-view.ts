import type { EnquiryRow } from "@/lib/enquiries/types";
import type { DealSummary } from "@/lib/people/types";
import { enumLabel } from "../../../../lib/classes/types.ts";
import { formatDate, formatDateTime } from "../../../../lib/format/date.ts";

// Spec §9.13 view logic, in a plain module so a test can drive it without a
// browser, and so the server page can import its values (a `"use client"`
// module would hand it a reference instead; tests/client-boundary.test.ts).
// The eight columns in §9.13's order.
export const QUEUE_COLUMNS = [
  "Person",
  "Channel",
  "Category",
  "Status",
  "Assigned",
  "First message",
  "First response",
  "Age",
] as const;

// §9.13 spec: an unset value reads as a dash, never blank, zero or a guess.
export const DASH = "—";

// Words, not a colour: the text that sits beside the past-SLA highlight so
// the state survives without colour (§14).
export const PAST_SLA_MARKER = "Past SLA";

// enumLabel only capitalises the first letter; these values need their own
// words ("Whatsapp", "Hrdc" and "Ai resolved" read as typos).
const LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  ctwa: "WhatsApp ad",
  hrdc: "HRDC",
  walk_in: "Walk-in",
  ai_resolved: "Resolved by AI",
  human_resolved: "Resolved",
};
export const enquiryLabel = (value: string) =>
  LABELS[value] ?? enumLabel(value);

// Whole minutes since the enquiry started waiting, in the largest two units.
export function ageLabel(minutes: number): string {
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

// The queue is about this week: a date in the current year drops the year
// ("26 Oct, 5:05pm"); an older one keeps it.
export function queueDateTime(date: string, now: Date = new Date()): string {
  return formatDateTime(date).replace(` ${formatDate(now).slice(-4)},`, ",");
}

// How long the first reply took — the number the SLA is about — rather than
// a second timestamp to subtract by eye.
export function responseLabel(row: EnquiryRow): string {
  if (!row.firstResponseAt) return DASH;
  if (!row.firstMessageAt) return queueDateTime(row.firstResponseAt);
  const ms = Date.parse(row.firstResponseAt) - Date.parse(row.firstMessageAt);
  return ageLabel(Math.max(0, Math.floor(ms / 60_000)));
}

// One row's cells, in QUEUE_COLUMNS order. The name has already fallen back
// to the phone on the server (§11.2, `displayName`).
export function queueCells(row: EnquiryRow): string[] {
  return [
    row.personName,
    enquiryLabel(row.channel),
    row.category ? enquiryLabel(row.category) : DASH,
    enquiryLabel(row.status),
    row.assigneeName ?? DASH,
    row.firstMessageAt ? queueDateTime(row.firstMessageAt) : DASH,
    responseLabel(row),
    ageLabel(row.waitedMinutes),
  ];
}

export type QueueAccess = {
  viewerId: string;
  // §6 enquiry write at all: super_admin, support, part_time.
  canWrite: boolean;
  // §6 "A": part_time, limited to rows assigned to them.
  assignedOnly: boolean;
};

// What the screen offers on a row. Mirrors the service's rules so no control
// is shown that the route would refuse — the route still checks (§9.13).
export function rowActions(row: EnquiryRow, access: QueueAccess) {
  const mayTouch =
    access.canWrite &&
    (!access.assignedOnly || row.assignedUserId === access.viewerId);
  return {
    // Handing work out is for the roles that write every enquiry.
    assign: mayTouch && !access.assignedOnly,
    category: mayTouch,
    // Closing is final, so only an open enquiry offers it.
    close: mayTouch && row.status === "open",
  };
}

// The context panel's open deals: anything not yet won or lost (§12.5).
export const openDeals = (deals: DealSummary[]) =>
  deals.filter((d) => d.stage !== "won" && d.stage !== "lost");

// The queue's URL, built from the view (§7 shape). The page reads the same
// keys back, so a link or a reload lands on the same view.
export type QueueView = {
  q: string;
  status: string;
  category: string;
  channel: string;
  assignee: string;
  mine: boolean;
  sort: string;
  page: number;
  selected: string;
};

export function queueParams(v: QueueView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  // `open` is the default, so it stays out of the URL.
  if (v.status && v.status !== "open") p.set("filter[status]", v.status);
  if (v.category) p.set("filter[category]", v.category);
  if (v.channel) p.set("filter[channel]", v.channel);
  if (v.assignee) p.set("filter[assignee]", v.assignee);
  if (v.mine) p.set("filter[mine]", "true");
  if (v.sort) p.set("sort", v.sort);
  if (v.page > 1) p.set("page", String(v.page));
  if (v.selected) p.set("selected", v.selected);
  return p;
}

// Whether any filter narrows the default view, so an empty table can tell
// "nothing yet" from "nothing matches" (§13).
export const isFiltered = (v: QueueView) =>
  Boolean(
    v.q ||
    v.status !== "open" ||
    v.category ||
    v.channel ||
    v.assignee ||
    v.mine,
  );
