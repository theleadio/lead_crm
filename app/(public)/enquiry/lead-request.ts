import { apiKeys, requestIp, type Env } from "../../../lib/public/guard.ts";
import { dictionary, type Dict } from "../dictionaries.ts";
import type { Locale } from "../locale.ts";

// The server half of the submit path: the §8.2 request this app builds for
// itself, and the §13 wording its answers turn into. Separate from submit.ts
// because a "use server" module may export only async functions, and separate
// from form-contract.ts because this reaches lib/public/.

// §8.2's touchpoint name, in the §8.2 convention Shawn settled on the review
// of this branch: source number, brand, the language of the page, then the
// form. It names the page's language and not the preferredLanguage field —
// the two differ, and this one says where the lead came from. The Chinese
// page carries ".02 LEAD - ZH - Website Enquiry" and brings it with it (#13).
export const FORM_NAME = ".02 LEAD - EN - Website Enquiry";

// §13: what a visitor is told, by response code, in the language they are
// reading. The route's own `message` strings are not shown in either locale —
// they describe the API, not the situation (website-lead-capture).
export function wording(code: string, locale: Locale): string {
  const t = dictionary(locale);
  switch (code) {
    case "captcha_failed":
      return t["error.captcha_failed"];
    case "rate_limited":
      return t["error.rate_limited"];
    case "payload_too_large":
      return t["error.payload_too_large"];
    case "validation_failed":
      return t["error.validation_failed"];
    // §8.3's refusals (website-register). Each says what to do next, because
    // the visitor can act on all three: pick another class, enquire, or stop.
    case "class_unavailable":
      return t["error.class_unavailable"];
    case "no_seats":
      return t["error.no_seats"];
    case "already_enrolled":
      return t["error.already_enrolled"];
    // An unset key, an unset rate-limit secret or a key we got wrong is our
    // deployment's fault, not the visitor's, so it never reads as their
    // mistake — and it is logged, because nobody else will notice it.
    case "not_configured":
    case "unauthorized":
    case "origin_not_allowed":
    case "invalid_json":
      return t["error.not_configured"];
    default:
      return t["error.server_error"];
  }
}

// §8.2's validation_failed names the fields that failed and carries zod's own
// messages. Those are written for an API caller and are English whatever the
// visitor is reading, so the field name is kept and the message replaced
// (website-lead-capture). A field with no message of its own gets the generic
// one rather than the route's wording.
const FIELD_MESSAGE: Record<string, keyof Dict> = {
  fullName: "field.fullName",
  email: "field.email",
  phone: "field.phone",
  companyName: "field.tooLong",
  jobTitle: "field.tooLong",
  message: "field.tooLong",
};

export function fieldWording(
  fields: Record<string, string>,
  locale: Locale,
): Record<string, string> {
  const t = dictionary(locale);
  const out: Record<string, string> = {};
  for (const name of Object.keys(fields))
    out[name] = t[FIELD_MESSAGE[name] ?? "field.default"];
  return out;
}

// The handshake with §8.2, which no compiler checks. Tested directly in
// tests/public-lead-form.test.ts rather than only through its result: a
// missing x-real-ip would put every visitor in one rate-limit bucket and a
// present Origin would be a 403 in production only — both silent.
export function buildRequest(
  payload: Record<string, unknown>,
  incoming: Headers,
  env: Env = process.env,
  // Which §8 route this is for: "/leads" (§8.2) or "/register" (§8.3). Only
  // the URL changes — the key, the IP and the Referer handshake below are the
  // same door, and both routes read the same three headers.
  path: "/leads" | "/register" = "/leads",
): Request {
  const headerBag: Record<string, string> = {
    "content-type": "application/json",
    // Read on the server and never rendered. PUBLIC_API_KEY may hold several
    // comma-separated keys for rotation (§14); any of them is accepted, so
    // this sends the first. Through apiKeys and not a raw split, because the
    // guard ignores entries under 16 characters: a list led by a short one
    // would send a key §8.2 rejects, and a rejected key reads as a bad caller
    // rather than the misconfiguration it is. Nothing left to send leaves it
    // empty, and §8.2 answers 503 — closed, not open.
    "x-api-key": apiKeys(env)[0] ?? "",
  };

  // No Origin header at all. §8.2 allows that case by design — "a server call
  // sends no Origin and is unaffected" — and it is the same door the
  // marketing site's own server comes through.

  // The visitor's address, not this server's, so the 10/minute bucket counts
  // the person who filled the form in. Both locales reach §8.2 through this
  // one path, so a visitor who tries the other language counts against the
  // same bucket (website-lead-capture).
  const ip = requestIp(incoming);
  if (ip) headerBag["x-real-ip"] = ip;

  // §8.2 takes the landing URL from the body only when its origin is on
  // PUBLIC_ALLOWED_ORIGINS — the marketing site's list, which this app is not
  // on — and otherwise falls back to the Referer header. So the visitor's
  // landing URL is passed in the slot the handler actually reads it from.
  // Without this the landing URL would be recorded in development (where
  // localhost is allow-listed) and lost in production.
  const landing = (payload.attribution as { landingUrl?: string } | null)
    ?.landingUrl;
  if (landing) headerBag.referer = landing;

  // The URL is never fetched. Request requires one, and §8.2 reads only the
  // method, the headers and the body.
  return new Request(`https://lead-crm.internal/api/public${path}`, {
    method: "POST",
    headers: headerBag,
    body: JSON.stringify(payload),
  });
}
