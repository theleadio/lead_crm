import type { Env } from "./guard.ts";

// Where PUBLIC_WEBSITE_URL is read. The marketing site is the only thing
// outside this app that the public pages and the §8.1 feed link to, so both
// readers of the variable live here rather than beside one caller.

// PUBLIC_WEBSITE_URL without trailing slashes, or null when unset (then every
// registerUrl is null).
export function websiteBase(env: Env): string | null {
  return (env.PUBLIC_WEBSITE_URL ?? "").trim().replace(/\/+$/, "") || null;
}

// The privacy notice beside a consent box (§10.3, §10.4). This app serves no
// privacy page, so the link points at the marketing site's and is null when
// PUBLIC_WEBSITE_URL is unset — a dead link next to a consent box is worse
// than no link. Both forms carry the same box, so neither page owns it.
//
// `/terms` and not `/privacy`: the notice lives at thelead.io/terms/, titled
// "Privacy, Refund Policy & Terms and Conditions". `/privacy` and
// `/privacy-policy` both 404 (Shawn checked the site, PR #11, 26 Oct 2026).
export function privacyUrl(env: Env = process.env): string | null {
  const base = websiteBase(env);
  return base ? `${base}/terms` : null;
}
