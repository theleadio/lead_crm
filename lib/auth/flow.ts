import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  cookieHeader,
  readCookie,
  redirectWith,
  signSession,
} from "./session.ts";
import { safeNext, signIn, signOut } from "./sign-in.ts";

// "Sign in with AI365": a one-time-code handoff (the AI365 team's guide).
// 1. /auth/ai365/start keeps a random state (and where to go after) in
//    short-lived cookies and sends the browser to AI365.
// 2. AI365 sends it back to /auth/ai365/callback with ?code&state. We check
//    the state, trade the code for an email server to server, check the
//    email against app_user, and set the CRM's own session cookie.
// Everything is top-level navigation; nothing here is called with fetch.

export const STATE_COOKIE = "ai365_state";
export const NEXT_COOKIE = "ai365_next";
// Both flow cookies only travel back to the callback, for ten minutes.
const FLOW_PATH = "/auth/ai365";
const FLOW_MAX_AGE = 600;

// Fails closed: sign-in is refused unless every server-only value is set.
function ai365Config(): { base: string; secret: string } | null {
  const base = process.env.AI365_BASE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.AI365_HANDOFF_SECRET?.trim();
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  return base && secret && sessionSecret.length >= 32 ? { base, secret } : null;
}

const toSignIn = (request: Request, error: string) =>
  new URL(`/sign-in?error=${error}`, request.url);

// GET /auth/ai365/start?next=/deals
export function startSignIn(request: Request): Response {
  const config = ai365Config();
  if (!config) return redirectWith(toSignIn(request, "unavailable"), []);
  const state = randomBytes(32).toString("base64url");
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const handoff = new URL(`${config.base}/api/sso/handoff`);
  handoff.search = new URLSearchParams({ client: "crm", state }).toString();
  return redirectWith(handoff, [
    cookieHeader(request, STATE_COOKIE, state, FLOW_MAX_AGE, FLOW_PATH),
    cookieHeader(
      request,
      NEXT_COOKIE,
      encodeURIComponent(next),
      FLOW_MAX_AGE,
      FLOW_PATH,
    ),
  ]);
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function decodeNext(raw: string | undefined): string {
  try {
    return safeNext(raw === undefined ? null : decodeURIComponent(raw));
  } catch {
    return safeNext(null);
  }
}

// GET /auth/ai365/callback?code=…&state=… or ?error=exchange_failed&state=…
// fetchFn is injectable so tests never reach the network.
export async function finishSignIn(
  request: Request,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const sent = params.get("state") ?? "";
  const kept = readCookie(request, STATE_COOKIE) ?? "";
  const next = decodeNext(readCookie(request, NEXT_COOKIE));
  // The flow cookies end here, whatever the outcome.
  const clear = [
    cookieHeader(request, STATE_COOKIE, "", 0, FLOW_PATH),
    cookieHeader(request, NEXT_COOKIE, "", 0, FLOW_PATH),
  ];
  const fail = (error: string) => redirectWith(toSignIn(request, error), clear);

  if (!sent || !kept || !sameString(sent, kept)) return fail("state");
  if (params.has("error"))
    return fail(
      params.get("error") === "exchange_failed" ? "not_verified" : "expired",
    );
  const code = params.get("code");
  if (!code) return fail("expired");
  const config = ai365Config();
  if (!config) return fail("unavailable");

  // The code is single-use and lives 60 seconds: one attempt, never retried.
  // Never log the code, the secret or the session cookie.
  let res: Response;
  try {
    res = await fetchFn(`${config.base}/api/sso/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-handoff-secret": config.secret,
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("AI365 exchange: no answer");
    return fail("unavailable");
  }
  if (res.status === 401) return fail("expired");
  const body = res.ok ? await res.json().catch(() => null) : null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    console.error(`AI365 exchange: unexpected answer (HTTP ${res.status})`);
    return fail("unavailable");
  }

  const userId = await signIn(
    { email },
    "ai365",
    request.headers.get("x-forwarded-for"),
  );
  if (!userId) return noAccess(clear, config.base);
  return redirectWith(new URL(next, request.url), [
    ...clear,
    cookieHeader(
      request,
      SESSION_COOKIE,
      await signSession(userId),
      SESSION_TTL,
    ),
  ]);
}

// POST /auth/dev-sign-in — local development only. AI365 only sends people
// back to the production site, so on localhost this is the way in: a normal
// session for DEV_USER_ID. Checked per request, so a production build answers
// 404 whatever any page shows.
export async function devSignIn(request: Request): Promise<Response> {
  const id = process.env.DEV_USER_ID?.trim();
  if (process.env.NODE_ENV === "production" || !id)
    return new Response("Not found", { status: 404 });
  const userId = await signIn(
    { id },
    "dev",
    request.headers.get("x-forwarded-for"),
  );
  if (!userId) return noAccess([], null);
  return redirectWith(
    new URL("/people", request.url),
    [
      cookieHeader(
        request,
        SESSION_COOKIE,
        await signSession(userId),
        SESSION_TTL,
      ),
    ],
    303,
  );
}

// POST /auth/sign-out — the CRM session ends here, then AI365 ends its own and
// sends the browser back to the CRM's home page.
export async function signOutResponse(
  request: Request,
  user: { id: string } | null,
): Promise<Response> {
  await signOut(user, request.headers.get("x-forwarded-for"));
  const base = process.env.AI365_BASE_URL?.trim().replace(/\/+$/, "");
  return redirectWith(
    base
      ? `${base}/api/sso/logout?client=crm&next=/`
      : new URL("/sign-in", request.url),
    [cookieHeader(request, SESSION_COOKIE, "", 0)],
    303,
  );
}

// The guide's 403: signed in to AI365, but not on the CRM's staff list. A
// plain page, because a route handler can't render the app's own; the link
// signs them out of AI365 so they can pick another account.
function noAccess(setCookies: string[], base: string | null): Response {
  const again = base
    ? `${base}/api/sso/logout?client=crm&amp;next=/`
    : "/sign-in";
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No access to Lead CRM</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f5f6f8;color:#111827;padding:16px">
<main style="max-width:24rem;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:32px">
<h1 style="font-size:1.125rem;margin:0 0 12px">No access to Lead CRM</h1>
<p style="font-size:.875rem;color:#4b5563;margin:0 0 20px">Your AI365 account isn't on the Lead CRM staff list. Ask a super admin to add you, then sign in again.</p>
<a href="${again}" style="font-size:.875rem;color:#1d4ed8">Sign in with a different account</a>
</main></body></html>`,
    { status: 403, headers },
  );
}
