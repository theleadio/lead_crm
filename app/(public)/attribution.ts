// §10.2. The attribution rules, as plain functions with no DOM and no React,
// so they can be tested without a browser and imported from both the client
// component that writes the cookies and the server action that reads them.
//
// Nothing here identifies anybody: a touch holds the campaign fields, the
// landing URL, the referrer and a time. That is what lets §10.2 call these
// cookies functional rather than marketing storage (see the PDPA question in
// the change proposal).

export const FIRST_TOUCH_COOKIE = "lead_first_touch";
export const LAST_TOUCH_COOKIE = "lead_last_touch";

// §10.2 asks for 90 days on the first touch. The last touch is rewritten on
// every visit, so its expiry only has to outlive the first one.
export const TOUCH_MAX_AGE_DAYS = 90;

export type Touch = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  fbclid: string | null;
  landingUrl: string | null;
  referrer: string | null;
  // ISO 8601. On the first touch this is the moment §8.2 places the earlier
  // visit at; on the last touch it is informational.
  occurredAt: string;
};

// The O14 shape, kept deliberately identical to cleanUrl() in
// lib/public/leads.ts: path plus utm_*, gclid and fbclid, no credentials and
// no fragment. That module imports the database, so it cannot be pulled into
// a client bundle — the rule is written twice and pinned by a test that runs
// both over the same inputs (tests/public-lead-form.test.ts).
export function trimUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.username = "";
    u.password = "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (!/^(utm_[a-z]+|gclid|fbclid)$/.test(k)) u.searchParams.delete(k);
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

const value = (v: string | null, max: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

// What this arrival looks like. `href` is the address the visitor is on and
// `referrer` is where they came from; both are untrusted strings, so both go
// through the same trimming the server would apply.
export function touchFrom(
  href: string,
  referrer: string | null,
  now: Date = new Date(),
): Touch {
  let q: URLSearchParams;
  try {
    q = new URL(href).searchParams;
  } catch {
    q = new URLSearchParams();
  }
  const p = (k: string, max = 200) => value(q.get(k), max);
  return {
    utmSource: p("utm_source"),
    utmMedium: p("utm_medium"),
    utmCampaign: p("utm_campaign"),
    utmContent: p("utm_content"),
    utmTerm: p("utm_term"),
    gclid: p("gclid"),
    fbclid: p("fbclid", 500),
    landingUrl: trimUrl(href),
    referrer: trimUrl(referrer),
    occurredAt: now.toISOString(),
  };
}

// Cookies hold one line of text, so the JSON is URL-encoded. A value we
// cannot read is treated as absent rather than repaired: the next arrival
// writes a fresh one, and a first touch is only ever replaced when there is
// none to keep.
export function serialiseTouch(t: Touch): string {
  return encodeURIComponent(JSON.stringify(t));
}

export function parseTouch(raw: string | null | undefined): Touch | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw));
    if (!o || typeof o !== "object") return null;
    if (typeof o.occurredAt !== "string") return null;
    return o as Touch;
  } catch {
    return null;
  }
}

// §10.2 names overwriting the first touch as the mistake that "breaks all
// attribution reporting", so the decision gets its own function and its own
// test. An unreadable existing value counts as no value; anything readable is
// kept, whatever campaign this arrival carries.
export const hasCampaign = (t: Touch): boolean =>
  !!(
    t.utmSource ||
    t.utmMedium ||
    t.utmCampaign ||
    t.utmContent ||
    t.utmTerm ||
    t.gclid ||
    t.fbclid
  );

// Whether this page was reached from somewhere other than our own site. A
// move between our public pages carries one of our own URLs as the referrer,
// which is how a navigation is told apart from an arrival.
function cameFromElsewhere(href: string, referrer: string | null): boolean {
  if (!referrer) return true;
  try {
    return new URL(referrer).origin !== new URL(href).origin;
  } catch {
    return true;
  }
}

export function nextTouches(
  existingFirstRaw: string | null | undefined,
  href: string,
  referrer: string | null,
  now: Date = new Date(),
  existingLastRaw?: string | null,
): { first: Touch | null; last: Touch | null } {
  const arrival = touchFrom(href, referrer, now);
  const kept = parseTouch(existingFirstRaw);
  const keptLast = parseTouch(existingLastRaw);

  // The last touch is the campaign that brought the visitor back, so a move
  // from /schedule to /enquiry must not erase it just because the second page
  // carries no utm_* of its own. It is rewritten when this arrival has
  // campaign fields, when there is nothing stored yet, or when the visitor
  // came from outside — and left alone otherwise. Without this, every lead
  // that reached the form by clicking a card recorded no campaign at all.
  const refreshLast =
    !keptLast || hasCampaign(arrival) || cameFromElsewhere(href, referrer);

  // null = leave the stored value alone. Rewriting the first touch would also
  // roll its 90 days forward, which is not the 90 days §10.2 asks for.
  return {
    first: kept ? null : arrival,
    last: refreshLast ? arrival : null,
  };
}

// What §8.2's `attribution` object wants. The route's schema takes the full
// field set for the current touch but only utmSource, utmMedium, utmCampaign
// and occurredAt inside `firstTouch`, so the rest of a stored first touch
// stays in the cookie — see the open question in the change proposal.
export function attributionPayload(
  first: Touch | null,
  last: Touch | null,
): Record<string, unknown> | null {
  if (!first && !last) return null;
  const current = last ?? first!;
  return {
    utmSource: current.utmSource,
    utmMedium: current.utmMedium,
    utmCampaign: current.utmCampaign,
    utmContent: current.utmContent,
    utmTerm: current.utmTerm,
    gclid: current.gclid,
    fbclid: current.fbclid,
    landingUrl: current.landingUrl,
    referrer: current.referrer,
    firstTouch: first
      ? {
          utmSource: first.utmSource,
          utmMedium: first.utmMedium,
          utmCampaign: first.utmCampaign,
          occurredAt: first.occurredAt,
        }
      : null,
  };
}
