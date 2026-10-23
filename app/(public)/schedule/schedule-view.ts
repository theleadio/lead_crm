import type { ScheduleClass } from "@/lib/public/schedule";
import type { Dict } from "../dictionaries.ts";
import { enquiryUrl } from "../enquiry-link.ts";
import { LOCALE_LABEL, type Locale } from "../locale.ts";

// The 10.1 page's view rules, in a plain module so they can be tested without
// React and imported from both the server page and the client list. Values
// must not live in the `"use client"` module: a server component importing one
// gets a client reference, not the value (see tests/client-boundary.test.ts).
//
// Everything that produces a word takes the active locale's dictionary, which
// the server page reads and passes down (§10.5). Nothing here translates what
// the §8.1 feed returned: a course name, a venue, a city and a code are data.

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

// The language a class is taught in, which is not the language the page is
// read in: "English" and "中文" either way (§10.5, website-localisation). A
// Chinese page lists an English class as English, because that is what the
// visitor would be sitting in.
export function languageLabel(language: string): string {
  return language === "en" || language === "zh"
    ? LOCALE_LABEL[language as Locale]
    : language;
}

export function seatsLabel(c: ScheduleClass, t: Dict): string {
  switch (c.seatsLabel) {
    case "available":
      return t["card.seats.available"];
    case "few_seats":
      return t["card.seats.few_seats"];
    case "full":
      return t["card.seats.full"];
    default:
      return c.seatsLabel;
  }
}

// The six §5 course tracks. An unrecognised value is shown as the feed gave
// it rather than guessed at — the feed is the only place tracks come from,
// and a new one is a schema change we would hear about.
export function trackLabel(track: string, t: Dict): string {
  switch (track) {
    case "certification":
      return t["track.certification"];
    case "mastery":
      return t["track.mastery"];
    case "masterclass":
      return t["track.masterclass"];
    case "workshop":
      return t["track.workshop"];
    case "conference":
      return t["track.conference"];
    case "corporate":
      return t["track.corporate"];
    default:
      return track.charAt(0).toUpperCase() + track.slice(1);
  }
}

// A class with no time shows its date alone (§8.1, v1.21) — no empty slot and
// no placeholder.
export function timeLabel(c: ScheduleClass): string | null {
  if (!c.startTime) return null;
  return c.endTime ? `${c.startTime} – ${c.endTime}` : c.startTime;
}

// Where a class sits on the card: the venue and city for an in-person class,
// the locale's word for "online" for an online one. §8.1 nulls both for
// `online`, so this is not a fallback for a missing venue. The venue and city
// themselves are data and stay as the feed gave them.
export function placeLabel(c: ScheduleClass, t: Dict): string {
  if (c.mode === "online") return t["card.online"];
  return [c.venueName, c.city].filter(Boolean).join(", ");
}

export type RegisterControl = {
  href: string | null;
  // Why the control leads nowhere, for the disabled state (§14). Null when it
  // is a working link.
  reason: string | null;
  label: string;
};

// §10.4 is not built (O43, waiting on the Stripe keys), so every `registerUrl`
// the feed gives points at a page the website does not serve. Until it ships
// the card offers the enquiry link instead of a 404. Flip this one line when
// 10.4 lands and the cards go back to the feed's URL.
export const REGISTRATION_LIVE = false;

// A full class cannot be registered for, and neither can one whose register
// URL is missing — a disabled control beats a link that goes nowhere (§10.1).
export function registerControl(
  c: ScheduleClass,
  locale: Locale,
  t: Dict,
): RegisterControl {
  // Registration is not open to anyone yet, so the card asks for an enquiry
  // whatever the class's seats say: enquiring about a full class is a fair
  // thing to want, and the seats label beside it already says "Full".
  // The enquiry form is our own page, in this page's own locale, and carries
  // this class's code, so there is no "no destination" case left to disable
  // the control for.
  if (!REGISTRATION_LIVE)
    return {
      href: enquiryUrl(locale, c.code),
      label: t["card.enquire"],
      reason: null,
    };
  // The seats label beside it already says "Full", so the control keeps the
  // same word it has everywhere else rather than repeating the reason.
  if (c.seatsLabel === "full")
    return {
      href: null,
      label: t["card.register"],
      reason: t["card.register.full"],
    };
  if (!c.registerUrl)
    return {
      href: null,
      label: t["card.register"],
      reason: t["card.register.notOpen"],
    };
  return { href: c.registerUrl, label: t["card.register"], reason: null };
}
