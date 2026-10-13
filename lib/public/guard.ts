import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { clientIp } from "../audit.ts";
import { apiError } from "../api/errors.ts";
import { db } from "../sql.ts";
import { COOKIE_TOUCH_REF } from "./leads.ts";

// Spec §8: the trust boundary of the public API — API key, CORS allow-list,
// CAPTCHA, rate limit. Nothing here logs a request body, a phone, an email or
// an IP, and the public lead code writes no IP to audit_log either (PDPA, §14).

export type Env = Record<string, string | undefined>;

// ---- API key (X-Api-Key against PUBLIC_API_KEY) ----------------------------

const digest = (s: string) => createHash("sha256").update(s).digest();

// PUBLIC_API_KEY may hold several keys, comma separated, so a key can be
// rotated without a gap (§14). Unset, empty or shorter than 16 characters =
// not configured = the API stays closed.
export function apiKeys(env: Env): string[] {
  return (env.PUBLIC_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 16);
}

// Constant time: both sides are hashed to 32 bytes first, so neither the
// value nor its length leaks through timing, and every key is always compared.
export function checkApiKey(
  env: Env,
  presented: string | null,
): "ok" | "bad" | "unconfigured" {
  const keys = apiKeys(env);
  if (keys.length === 0) return "unconfigured";
  const got = digest(presented ?? "");
  let ok = false;
  for (const k of keys) if (timingSafeEqual(digest(k), got)) ok = true;
  return ok ? "ok" : "bad";
}

// ---- CORS (LEAD website origins only, never a wildcard) --------------------

// PUBLIC_ALLOWED_ORIGINS="https://thelead.io,https://www.thelead.io". "*" and
// anything that is not an https origin (http only for localhost) is dropped.
export function allowedOrigins(env: Env): string[] {
  return (env.PUBLIC_ALLOWED_ORIGINS ?? "").split(",").flatMap((s) => {
    try {
      const u = new URL(s.trim());
      const ok = u.protocol === "https:" || u.hostname === "localhost";
      return ok ? [u.origin] : [];
    } catch {
      return [];
    }
  });
}

// A browser always sends Origin on a cross-origin call. No Origin = a server
// or a script (it still needs the key); a present Origin must be on the list.
export function originAllowed(env: Env, origin: string | null): boolean {
  return origin === null || allowedOrigins(env).includes(origin);
}

export function withCors(
  env: Env,
  origin: string | null,
  res: Response,
  extra: Record<string, string> = {},
): Response {
  res.headers.set("Vary", "Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  }
  return res;
}

// ---- Client IP and rate limit ----------------------------------------------

// x-real-ip, then the first x-forwarded-for hop, as the platform sets them.
// Only sound behind a proxy that overwrites both (Vercel does) — see O40.
export function requestIp(headers: Headers): string | null {
  return (
    clientIp(headers.get("x-real-ip")) ??
    clientIp(headers.get("x-forwarded-for"))
  );
}

// The HMAC key of the IP bucket: a server-only secret. It must not be the API
// key, which the website's browsers hold, or anyone with the key could
// rebuild the bucket of a known address. Unset or shorter than 16 characters
// = not configured = the lead route stays closed (503), like the API key.
export function rateLimitSecret(env: Env): string | null {
  const s = (env.RATE_LIMIT_SECRET ?? "").trim();
  return s.length >= 16 ? s : null;
}

// 10/IP/min (§8.2). The bucket is an HMAC of the address keyed with
// RATE_LIMIT_SECRET, so the table never holds an IP (the keyed hash is a
// pseudonym: it lives at most an hour). The caller has checked rateLimitSecret.
// Returns true when over the limit.
export async function ipLimited(env: Env, ip: string | null): Promise<boolean> {
  const secret = rateLimitSecret(env);
  if (!secret) throw new Error("RATE_LIMIT_SECRET not configured");
  const bucket = ip
    ? `ip:${createHmac("sha256", secret).update(ip).digest("hex")}`
    : "ip:unknown";
  const [r] = await db()`SELECT rate_limit_take(${bucket}, 60) AS hits`;
  return r.hits > 10;
}

// 3/phone/hour (§8.2): accepted web-form submissions of the person who owns
// this number in the last hour (touchpoint_person_time_idx). No table. The
// synthetic first touch made from a cookie is a visit, not a submission.
export async function phoneLimited(phoneE164: string | null): Promise<boolean> {
  if (!phoneE164) return false;
  const [r] = await db()`
    SELECT count(*)::int AS n
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE p.phone_e164 = ${phoneE164} AND t.channel = 'web_form'
      AND t.occurred_at > now() - interval '1 hour'
      AND (t.external_ref IS NULL OR t.external_ref NOT LIKE ${COOKIE_TOUCH_REF + "%"})`;
  return r.n >= 3;
}

export const rateLimited = () =>
  apiError(429, "rate_limited", "Too many requests. Try again in a minute.");

// ---- CAPTCHA ---------------------------------------------------------------

export type CaptchaVerifier = (
  token: string | null | undefined,
  ip: string | null,
) => Promise<boolean>;

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare Turnstile, the fallback for the undecided provider (O39). Any
// failure of the check itself counts as a failed check.
export function turnstile(
  secret: string,
  fetchImpl: typeof fetch = fetch,
): CaptchaVerifier {
  return async (token, ip) => {
    if (!token) return false;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set("remoteip", ip);
      const res = await fetchImpl(TURNSTILE_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      return (await res.json()).success === true;
    } catch {
      return false;
    }
  };
}

// Closed unless a provider is configured. The only way to switch it off is
// PUBLIC_CAPTCHA_DISABLED=true outside production (local development).
export function defaultCaptcha(env: Env): CaptchaVerifier {
  if (env.TURNSTILE_SECRET_KEY) return turnstile(env.TURNSTILE_SECRET_KEY);
  if (env.PUBLIC_CAPTCHA_DISABLED === "true" && env.NODE_ENV !== "production")
    return async () => true;
  return async () => false;
}
