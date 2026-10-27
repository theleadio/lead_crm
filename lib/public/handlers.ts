import type { ZodError } from "zod";
import { apiError, validationError } from "../api/errors.ts";
import { stripeCheckout, type CheckoutPort } from "../payments/checkout.ts";
import {
  leadSchema,
  registerSchema,
  scheduleQuerySchema,
} from "../validation/public.ts";
import { findRegisterReplay, register } from "./register.ts";
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
import { db, withTransaction } from "../sql.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { websiteBase } from "./links.ts";
import { listPublicSchedule } from "./schedule.ts";

// Spec §8: the only routes reachable without a session. The route files are
// one-liners over these, so tests can call them with a fake env and CAPTCHA.

export type PublicDeps = {
  env: Env;
  captcha?: CaptchaVerifier;
  // The Stripe Checkout port (§8.3 step 4), injected like the CAPTCHA
  // verifier so a test never reaches the network. `/leads` ignores it.
  checkout?: CheckoutPort;
};
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

  const body = await listPublicSchedule(parsed.data, websiteBase(d.env));
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

// What every intake route gets once the checks have passed: the deps, who
// asked, and the attribution §8.2 decided to believe.
export type IntakeCtx = {
  d: PublicDeps;
  origin: string | null;
  ip: string | null;
  landingUrl: string | null;
  referrer: string | null;
};

// One intake route. `/leads` (§8.2) and `/register` (§8.3) differ only in
// these three: §8.3 step 1 is "everything 8.2 does", and the checks are
// shared code so a limit can never apply to one route and not the other.
type Intake<T> = {
  schema: { safeParse: (value: unknown) => SafeParse<T> };
  // An idempotency key's replay answer, looked up under the key's lock.
  // Null = no earlier call to answer with.
  replay: (key: string, input: T, ctx: IntakeCtx) => Promise<Response | null>;
  finish: (input: T, ctx: IntakeCtx) => Promise<Response>;
  // What a failure is called in the log. Never a request value (§13).
  logName: string;
};

type SafeParse<T> =
  { success: true; data: T } | { success: false; error: ZodError };

// POST /api/public/leads (§8.2).
export const handleLead = (request: Request, d: PublicDeps = live()) =>
  publicPost(request, d, {
    schema: leadSchema,
    replay: async (key, _input, ctx) => {
      const r = await findReplay(key);
      return r ? leadOk(d, ctx.origin, r) : null;
    },
    finish: async (input, ctx) =>
      leadOk(d, ctx.origin, await captureLead(input, ctx)),
    logName: "public lead failed",
  });

// POST /api/public/register (§8.3). Step 1 is §8.2's, whole: the same gate,
// the same limits, the same CAPTCHA, the same idempotency lock, the same
// capture. Steps 2-4 are `register()`.
export const handleRegister = (request: Request, d: PublicDeps = live()) =>
  publicPost(request, d, {
    schema: registerSchema,
    replay: async (key, input, ctx) => {
      const r = await findRegisterReplay(key, input.classCode);
      return r ? registerOk(d, ctx.origin, r) : null;
    },
    finish: async (input, ctx) => {
      const result = await register(input, ctx, {
        env: d.env,
        checkout: d.checkout ?? stripeCheckout(d.env),
      });
      switch (result.kind) {
        case "checkout":
        case "hrdc":
          return registerOk(d, ctx.origin, result);
        case "class_unavailable":
          return fail(
            d,
            ctx.origin,
            409,
            "class_unavailable",
            "That class is not open for registration.",
          );
        case "no_seats":
          return fail(d, ctx.origin, 409, "no_seats", "That class is full.");
        case "already_enrolled":
          return fail(
            d,
            ctx.origin,
            409,
            "already_enrolled",
            "You are already registered for that class.",
          );
        case "not_configured":
          return fail(d, ctx.origin, 503, "not_configured", "Not available.");
        case "provider_failed":
          return fail(
            d,
            ctx.origin,
            500,
            "server_error",
            "Something went wrong.",
          );
      }
    },
    logName: "public register failed",
  });

// §8.3's 201. `next` tells the page which way the visitor goes; the ids are
// returned as §8.2 returns them and the page displays neither.
function registerOk(
  d: PublicDeps,
  origin: string | null,
  r:
    | {
        kind: "checkout";
        personId: string;
        dealId: string;
        checkoutUrl: string;
      }
    | { kind: "hrdc"; personId: string; dealId: string },
) {
  const body =
    r.kind === "checkout"
      ? {
          ok: true,
          next: "checkout",
          checkoutUrl: r.checkoutUrl,
          personId: r.personId,
          dealId: r.dealId,
        }
      : {
          ok: true,
          next: "hrdc_contact",
          personId: r.personId,
          dealId: r.dealId,
        };
  return withCors(
    d.env,
    origin,
    Response.json(body, { status: 201, headers: NO_STORE }),
  );
}

// Everything after the gate runs inside one try/catch, so a database error in
// the rate limit, the replay lookup or the phone count answers like any other
// failure: generic 500, CORS and no-store headers, and a log line that names
// the error but holds no request data.
async function publicPost<T extends IntakeInput>(
  request: Request,
  d: PublicDeps,
  intake: Intake<T>,
): Promise<Response> {
  const origin = request.headers.get("origin");
  const denied = gate(request, d);
  if (denied) return denied;
  if (!rateLimitSecret(d.env))
    return fail(d, origin, 503, "not_configured", "Not available.");
  try {
    return await intakeFlow(request, d, origin, intake);
  } catch (err) {
    const e = err as { name?: string; code?: string };
    console.error(intake.logName, e.name, e.code);
    return fail(d, origin, 500, "server_error", "Something went wrong.");
  }
}

// What both schemas give the flow itself. Everything else is the route's.
type IntakeInput = {
  idempotencyKey: string | null;
  phone: string | null;
  captchaToken?: string | null;
  attribution?: { landingUrl?: string | null; referrer?: string | null } | null;
};

async function intakeFlow<T extends IntakeInput>(
  request: Request,
  d: PublicDeps,
  origin: string | null,
  intake: Intake<T>,
): Promise<Response> {
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
  const parsed = intake.schema.safeParse(json);
  if (!parsed.success) {
    const res = validationError(parsed.error);
    res.headers.set("Cache-Control", "no-store");
    return withCors(d.env, origin, res);
  }
  const input = parsed.data;

  const proceed = async () => {
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

    return intake.finish(input, {
      d,
      origin,
      ip,
      landingUrl,
      referrer: cleanUrl(input.attribution?.referrer),
    });
  };

  const key = input.idempotencyKey;
  if (!key) return proceed();
  // Step 8, for a repeat: the first call's CAPTCHA token is spent and a replay
  // is not a new submission, so it skips both checks. Two calls with one key
  // at once would both miss the replay and the loser's token would fail
  // (single-use) although the lead was saved, so they queue on a lock held to
  // the end of the transaction: the loser then finds the winner's committed
  // result. ponytail: one pooled connection is held while the CAPTCHA provider
  // answers (5 s at most); a per-key row or an edge limiter if that ever bites.
  return withTransaction(async () => {
    await db()`SELECT pg_advisory_xact_lock(hashtextextended(${`lead:${key}`}, 0))`;
    const replay = await intake.replay(key, input, {
      d,
      origin,
      ip,
      landingUrl: null,
      referrer: null,
    });
    return replay ?? proceed();
  });
}

// §8.2's 201: the ids only, and never a value the website should display.
function leadOk(
  d: PublicDeps,
  origin: string | null,
  r: { personId: string; dealId: string },
) {
  return withCors(
    d.env,
    origin,
    Response.json(
      { ok: true, personId: r.personId, dealId: r.dealId },
      { status: 201, headers: NO_STORE },
    ),
  );
}
