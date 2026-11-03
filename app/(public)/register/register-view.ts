import type { ScheduleClass } from "@/lib/public/schedule";

// §10.4's one decision: which of the page's shapes a class gets. A plain
// module, like schedule-view.ts, so it can be tested without React — Node's
// test runner cannot load a `.tsx` file at all.

export type RegisterState =
  // Seats, a payment provider, a class the feed lists: the form is shown.
  | "bookable"
  // Full today. The class is named, no payment control, enquiry offered.
  | "full"
  // Unknown, private, past, cancelled or completed — not a 404, because the
  // visitor came from somewhere (website-lead-capture).
  | "unavailable"
  // No payment provider configured, so a submission could only be refused.
  | "closed";

export function registerState(
  cls: ScheduleClass | null,
  live: boolean,
): RegisterState {
  if (!cls) return "unavailable";
  if (!live) return "closed";
  return cls.seatsLabel === "full" ? "full" : "bookable";
}
