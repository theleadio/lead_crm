import { apiError, validationError } from "../api/errors.ts";
import { leadSchema, scheduleQuerySchema } from "../validation/public.ts";
import {
  allowedOrigins,
  checkApiKey,
  defaultCaptcha,
  ipLimited,
  originAllowed,
  phoneLimited,
  rateLimited,
  rateLimitSecret,
  requestIp,
  withCors,
  type CaptchaVerifier,
  type Env,
} from "./guard.ts";
import { captureLead, cleanUrl, findReplay } from "./leads.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { listPublicSchedule } from "./schedule.ts";

// Spec §8: the only routes reachable without a session. The route files are
// one-liners over these, so tests can call them with a fake env and CAPTCHA.

export type PublicDeps = { env: Env; captcha?: CaptchaVerifier };
const live = (): PublicDeps => ({ env: process.env });

const MAX_BODY = 32 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function fail(
  d: PublicDeps,
  origin: string | null,
  status: number,
  code: string,
  message: string,
  extra?: Parameters<typeof apiError>[3],
) {
  const res = apiError(status, code, message, extra);
  res.headers.set("Cache-Control", "no-store");
  return withCors(d.env, origin, res);
}

// Origin, then key — shared by both routes. Returns an error response, or
// null when the caller may continue.
function gate(request: Request, d: PublicDeps): Response | null {
  const origin = request.headers.get("origin");
  if (!originAllowed(d.env, origin))
    return fail(d, null, 403, "origin_not_allowed", "Origin not allowed.");
  const key = checkApiKey(d.env, request.headers.get("x-api-key"));
  if (key === "unconfigured")
    return fail(d, origin, 503, "not_configured", "Not available.");
  if (key === "bad")
    return fail(d, origin, 401, "unauthorized", "Invalid API key.");
  return null;
}

// CORS preflight. Answered only for an allow-listed origin.
export function handleOptions(request: Request, d: PublicDeps = live()) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(d.env).includes(origin))
    return new Response(null, { status: 403, headers: NO_STORE });
  return withCors(d.env, origin, new Response(null, { status: 204 }), {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
    "Access-Control-Max-Age": "86400",
  });
}

// GET /api/public/schedule (§8.1)
export async function handleSchedule(request: Request, d: PublicDeps = live()) {
  const origin = request.headers.get("origin");
  const denied = gate(request, d);
  if (denied) return denied;

  const sp = new URL(request.url).searchParams;
  const parsed = scheduleQuerySchema.safeParse({
    language: sp.get("language") ?? undefined,
    track: sp.get("track") ?? undefined,
    city: sp.get("city") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    const res = validationError(parsed.error);
    res.headers.set("Cache-Control", "no-store");
    return withCors(d.env, origin, res);
  }

  const website = (d.env.PUBLIC_WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  const body = await listPublicSchedule(parsed.data, website || null);
  // 5 minutes at the edge (§8.1). The feed is public by design, so a cached
  // copy may be served without the key; see O38.
  return withCors(
    d.env,
    origin,
    Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=300" },
    }),
  );
}

// POST /api/public/leads (§8.2)
export async function handleLead(request: Request, d: PublicDeps = live()) {
  const origin = request.headers.get("origin");
  const denied = gate(request, d);
  if (denied) return denied;
  if (!rateLimitSecret(d.env))
    return fail(d, origin, 503, "not_configured", "Not available.");

  // Step 1: rate limit per IP, before any parsing or CAPTCHA call.
  const ip = requestIp(request.headers);
  if (await ipLimited(d.env, ip)) {
    const res = rateLimited();
    res.headers.set("Retry-After", "60");
    res.headers.set("Cache-Control", "no-store");
    return withCors(d.env, origin, res);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY)
    return fail(d, origin, 413, "payload_too_large", "Request too large.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(d, origin, 400, "invalid_json", "Send a JSON body.");
  }
  const parsed = leadSchema.safeParse(json);
  if (!parsed.success) {
    const res = validationError(parsed.error);
    res.headers.set("Cache-Control", "no-store");
    return withCors(d.env, origin, res);
  }
  const input = parsed.data;

  // Step 8 first, for a repeat: the CAPTCHA token of the first call is spent
  // and a replay is not a new submission, so it skips both checks.
  const ok = (r: { personId: string; dealId: string }) =>
    withCors(
      d.env,
      origin,
      Response.json(
        { ok: true, personId: r.personId, dealId: r.dealId },
        { status: 201, headers: NO_STORE },
      ),
    );
  if (input.idempotencyKey) {
    const replay = await findReplay(input.idempotencyKey);
    if (replay) return ok(replay);
  }

  // Step 1: CAPTCHA, then 3 per phone per hour.
  const captcha = d.captcha ?? defaultCaptcha(d.env);
  if (!(await captcha(input.captchaToken, ip)))
    return fail(d, origin, 403, "captcha_failed", "Check failed. Try again.");
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;
  if (await phoneLimited(phoneE164)) {
    const res = rateLimited();
    res.headers.set("Retry-After", "3600");
    res.headers.set("Cache-Control", "no-store");
    return withCors(d.env, origin, res);
  }

  // Attribution is informational (§8.2): the landing URL is the body's only
  // when it is on one of our own origins, else the Referer header.
  const bodyLanding = cleanUrl(input.attribution?.landingUrl);
  const landingUrl =
    bodyLanding && allowedOrigins(d.env).includes(new URL(bodyLanding).origin)
      ? bodyLanding
      : cleanUrl(request.headers.get("referer"));

  try {
    const result = await captureLead(input, {
      landingUrl,
      referrer: cleanUrl(input.attribution?.referrer),
    });
    return ok(result);
  } catch (err) {
    // No body, no phone, no email in the log — the error name and code only.
    const e = err as { name?: string; code?: string };
    console.error("public lead failed", e.name, e.code);
    return fail(d, origin, 500, "server_error", "Something went wrong.");
  }
}
