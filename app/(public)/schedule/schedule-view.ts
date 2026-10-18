import type { ScheduleClass } from "@/lib/public/schedule";

// The 10.1 page's view rules, in a plain module so they can be tested without
// React and imported from both the server page and the client list. Values
// must not live in the `"use client"` module: a server component importing one
// gets a client reference, not the value (see tests/client-boundary.test.ts).

export type Filters = { language: string; track: string; city: string };

// "" means "all". One shape, so clearing is assigning this.
export const NO_FILTERS: Filters = { language: "", track: "", city: "" };

export function filterClasses(
  classes: ScheduleClass[],
  f: Filters,
): ScheduleClass[] {
  return classes.filter(
    (c) =>
      (!f.language || c.language === f.language) &&
      (!f.track || c.track === f.track) &&
      (!f.city || c.city === f.city),
  );
}

// Only values present in the fetched set are offered, so a filter can never
// produce an empty list on its own (§10.1).
export function filterOptions(classes: ScheduleClass[]) {
  const take = (pick: (c: ScheduleClass) => string | null) =>
    [...new Set(classes.map(pick).filter((v): v is string => !!v))].sort();
  return {
    languages: take((c) => c.language),
    tracks: take((c) => c.track),
    cities: take((c) => c.city),
  };
}

export const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  zh: "中文",
};

export const SEATS_LABEL: Record<string, string> = {
  available: "Seats available",
  few_seats: "Few seats left",
  full: "Full",
};

export function trackLabel(track: string): string {
  return track.charAt(0).toUpperCase() + track.slice(1);
}

// Where a class sits on the card: the venue and city for an in-person class,
// "Online" for an online one. §8.1 nulls both for `online`, so this is not a
// fallback for a missing venue.
export function placeLabel(c: ScheduleClass): string {
  if (c.mode === "online") return "Online";
  return [c.venueName, c.city].filter(Boolean).join(", ");
}

// A class with no time shows its date alone (§8.1, v1.21) — no empty slot and
// no placeholder.
export function timeLabel(c: ScheduleClass): string | null {
  if (!c.startTime) return null;
  return c.endTime ? `${c.startTime} – ${c.endTime}` : c.startTime;
}

export type RegisterControl =
  { href: string; label: string } | { href: null; label: string };

// A full class cannot be registered for, and neither can one whose register
// URL is missing — a disabled control beats a link that goes nowhere (§10.1).
export function registerControl(c: ScheduleClass): RegisterControl {
  // The seats label beside it already says "Full", so the control keeps the
  // same word it has everywhere else rather than repeating the reason.
  if (c.seatsLabel === "full") return { href: null, label: "Register" };
  if (!c.registerUrl) return { href: null, label: "Registration opening soon" };
  return { href: c.registerUrl, label: "Register" };
}
