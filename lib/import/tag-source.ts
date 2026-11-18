// Tag -> opt-in source (plan: docs/superpowers/plans/2026-11-18-opt-in-source-tracking.md,
// phase 2). Pure: no database, no network.
//
// A SalesProcess tag says what a person joined, not when: the importer stamped
// almost every tag on 30 Oct. So this returns a source type and an entry point
// only, never a date. A tag that is not clearly an opt-in source returns null
// and is left for a person to map (free-text tags such as "penang 2122 follow
// up" are not guessed).

export const SOURCE_TYPES = [
  "paid_ad",
  "organic_social",
  "email",
  "whatsapp",
  "community",
  "referral",
  "event",
  "partner_ticket",
  "website",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type TagSource = { sourceType: SourceType; entryPoint: string };

// Exact tag names (lower case) whose meaning is clear.
const EXACT: Record<string, TagSource> = {
  "[source] meta ads": { sourceType: "paid_ad", entryPoint: "Meta ads" },
  "facebook form": { sourceType: "paid_ad", entryPoint: "Facebook lead form" },
};

// An [event] tag that records what happened after sign-up, not the sign-up.
const OUTCOME = /\b(attended|attendee|no-show|purchased|cancel)\b/;

const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function tagSource(tagName: string): TagSource | null {
  const n = squash(tagName);
  const exact = EXACT[n];
  if (exact) return exact;

  let m = /^\[event\] (.+)$/.exec(n);
  if (m && !OUTCOME.test(m[1]))
    return {
      sourceType: "event",
      entryPoint: m[1].replace(/ - registrant$/, ""),
    };

  m = /^\[(masterclass|workshop)\] (.+)$/.exec(n);
  if (m) return { sourceType: "event", entryPoint: `${m[1]} ${m[2]}` };

  return null;
}
