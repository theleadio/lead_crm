import type { ScheduleClass } from "@/lib/public/schedule";
import type { Dict } from "../dictionaries.ts";
import { enquiryUrl } from "../enquiry-link.ts";
import { LOCALE_LANG, localePath, type Locale } from "../locale.ts";

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

// The language a class is taught in, named in the page's own language: an
// English class reads "English" on the English page and 英文 on the Chinese
// one (§10.5, website-localisation). Which class it is never changes — only
// the word a reader is given for it, the same way the seats label and the
// track are the page's words about the feed's data.
export function languageLabel(language: string, t: Dict): string {
  switch (language) {
    case "en":
      return t["language.en"];
    case "zh":
      return t["language.zh"];
    default:
      return language;
  }
}

// The class's name in the page's own language, with the `lang` it needs
// (§10.5 as read in spec v1.24; the review of #12, item 2). The §8.1 feed
// returns both names, so a Chinese page shows the Chinese one and an English
// page the English one, whatever language the class is taught in. A course
// with no Chinese name falls back to its English name and says so on the
// element, because a screen reader would otherwise read Latin text in the
// Chinese voice (WCAG 3.1.2, Language of Parts). `lang` is null when the name
// is already in the page's language: the subtree says it once, on `<html>`.
// Nothing asserts a language over `courseNameEn` on the English page — it is
// the only name we have there, and claiming a language for a name we cannot
// identify is worse than claiming none.
export function courseName(
  c: Pick<ScheduleClass, "courseNameEn" | "courseNameZh">,
  locale: Locale,
): { text: string; lang: string | null } {
  if (locale !== "zh") return { text: c.courseNameEn, lang: null };
  if (c.courseNameZh) return { text: c.courseNameZh, lang: null };
  return { text: c.courseNameEn, lang: LOCALE_LANG.en };
}

// A heading template around its `{course}` placeholder, so the name can be
// its own element when it carries a `lang`. A template that has lost the
// placeholder keeps its words and takes the name after them, rather than
// rendering a heading with no class in it.
export function splitTemplate(template: string): [string, string] {
  const parts = template.split("{course}");
  return parts.length === 2 ? [parts[0], parts[1]] : [template, ""];
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

// §10.4 landed, so a class can be registered for — when a payment can
// actually complete. That is `checkoutConfigured(env)` in
// lib/payments/checkout.ts: the Stripe secret and an absolute APP_BASE_URL.
// The server page reads it and passes it in, because this module is imported
// by the client list and may hold no `process.env`
// (tests/client-boundary.test.ts). One answer for the route's 503 and for
// these cards, so a card can never invite a visitor into a path that ends in
// "not configured" (website-schedule, website-register).

export function registerControl(
  c: ScheduleClass,
  locale: Locale,
  t: Dict,
  live: boolean,
): RegisterControl {
  // No payment provider configured: nobody can register, so the card asks
  // for an enquiry whatever the class's seats say. The enquiry form is our
  // own page, in this page's own locale, and carries this class's code, so
  // there is no "no destination" case to disable the control for.
  if (!live)
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
  // Our own page, in this page's locale — not the feed's `registerUrl`, which
  // names the marketing site's origin and carries no locale, so a Chinese
  // reader would land on the English page. The feed's field is still read
  // above: null there means registration is not reachable at all (§8.1).
  return {
    href: localePath(locale, `/register/${encodeURIComponent(c.code)}`),
    label: t["card.register"],
    reason: null,
  };
}
