// Sign in with AI365 (lib/auth/flow.ts): the start redirect, the callback and
// the dev sign-in. AI365 is a fake fetch, so nothing reaches the network.
// Database cases run in a rolled-back transaction (tests/seed.ts).
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  NEXT_COOKIE,
  STATE_COOKIE,
  devSignIn,
  finishSignIn,
  startSignIn,
} from "../lib/auth/flow.ts";
import { SESSION_COOKIE, verifySession } from "../lib/auth/session.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it } from "./seed.ts";

after(closeDb);

const BASE = "https://ai365.test";
const HANDOFF = "handoff-secret-for-tests";
const STATE = "s".repeat(43);
const env = { ...process.env };

beforeEach(() => {
  Object.assign(process.env, {
    AI365_BASE_URL: BASE,
    AI365_HANDOFF_SECRET: HANDOFF,
    SESSION_SECRET: "x".repeat(40),
  });
});
afterEach(() => {
  process.env = { ...env };
});

type Call = { url: string; init: RequestInit };
// A fake AI365 /api/sso/exchange that records every call.
function fakeAi365(status: number, body: unknown = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const unreachable = (() => {
  throw new Error("AI365 must not be called");
}) as unknown as typeof fetch;

const callback = (query: string, cookies: Record<string, string> = {}) =>
  new Request(`https://crm.test/auth/ai365/callback?${query}`, {
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      "x-forwarded-for": "198.51.100.7",
    },
  });
const withState = (query: string, next?: string) =>
  callback(query, {
    [STATE_COOKIE]: STATE,
    ...(next ? { [NEXT_COOKIE]: encodeURIComponent(next) } : {}),
  });

const setCookies = (res: Response) => res.headers.getSetCookie();
const sessionOf = (res: Response) =>
  setCookies(res)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split(";")[0]
    .slice(SESSION_COOKIE.length + 1);
const assertFlowCleared = (res: Response) => {
  for (const name of [STATE_COOKIE, NEXT_COOKIE])
    assert.ok(
      setCookies(res).some(
        (c) => c.startsWith(`${name}=;`) && c.includes("Max-Age=0"),
      ),
      `${name} cleared`,
    );
};
const assertError = (res: Response, error: string) => {
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    `https://crm.test/sign-in?error=${error}`,
  );
  assert.equal(sessionOf(res), undefined);
  assertFlowCleared(res);
};

async function newStaff(email: string, active = true): Promise<string> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code, is_active)
    VALUES (${email}, 'AI365 test', 'sales', ${active}) RETURNING id`;
  return u.id;
}
const auditRows = async (action: string) =>
  await db()`SELECT user_id, entity_id, after, host(ip) AS ip FROM audit_log
             WHERE action = ${action} ORDER BY at DESC, id DESC`;

test("start: state + next cookies, then off to AI365's handoff", () => {
  const res = startSignIn(
    new Request("https://crm.test/auth/ai365/start?next=%2Fdeals%3Fx%3D1"),
  );
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assert.equal(`${to.origin}${to.pathname}`, `${BASE}/api/sso/handoff`);
  assert.equal(to.searchParams.get("client"), "crm");
  const state = to.searchParams.get("state")!;
  assert.match(state, /^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
  const [stateCookie, nextCookie] = setCookies(res);
  assert.equal(
    stateCookie,
    `${STATE_COOKIE}=${state}; Path=/auth/ai365; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
  );
  assert.match(nextCookie, new RegExp(`^${NEXT_COOKIE}=%2Fdeals%3Fx%3D1;`));
});

test("start: an unsafe next is replaced with the default", () => {
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
    const res = startSignIn(
      new Request(
        `https://crm.test/auth/ai365/start?next=${encodeURIComponent(bad)}`,
      ),
    );
    assert.match(setCookies(res)[1], new RegExp(`^${NEXT_COOKIE}=%2Fpeople;`));
  }
});

test("start: refuses without its settings", () => {
  for (const key of [
    "AI365_BASE_URL",
    "AI365_HANDOFF_SECRET",
    "SESSION_SECRET",
  ]) {
    const saved = process.env[key];
    delete process.env[key];
    const res = startSignIn(new Request("https://crm.test/auth/ai365/start"));
    assert.equal(
      res.headers.get("location"),
      "https://crm.test/sign-in?error=unavailable",
      key,
    );
    process.env[key] = saved;
  }
});

test("callback: missing or mismatched state is rejected, cookies cleared", async () => {
  for (const req of [
    callback("code=c"), // no cookie, no param
    callback("code=c&state=" + STATE), // param but no cookie
    withState("code=c"), // cookie but no param
    withState("code=c&state=" + "t".repeat(43)), // same length, different
    withState("code=c&state=short"),
  ])
    assertError(await finishSignIn(req, unreachable), "state");
});

test("callback: error=exchange_failed → not active or verified", async () => {
  assertError(
    await finishSignIn(
      withState(`error=exchange_failed&state=${STATE}`),
      unreachable,
    ),
    "not_verified",
  );
});

test("callback: exchange 401 → start again", async () => {
  const ai365 = fakeAi365(401, { error: "invalid_code" });
  assertError(
    await finishSignIn(withState(`code=c1&state=${STATE}`), ai365.fetchFn),
    "expired",
  );
  assert.equal(ai365.calls.length, 1); // never retried
});

test("callback: AI365 down or odd → sign-in unavailable, one call", async () => {
  for (const ai365 of [fakeAi365(500), fakeAi365(200, { full_name: "x" })]) {
    assertError(
      await finishSignIn(withState(`code=c&state=${STATE}`), ai365.fetchFn),
      "unavailable",
    );
    assert.equal(ai365.calls.length, 1);
  }
  const thrown = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assertError(
    await finishSignIn(withState(`code=c&state=${STATE}`), thrown),
    "unavailable",
  );
});

it("callback: exchanges the code once, server to server, with the secret", async () => {
  await newStaff("once@lead.test");
  const ai365 = fakeAi365(200, { email: "once@lead.test", full_name: null });
  await finishSignIn(withState(`code=abc123&state=${STATE}`), ai365.fetchFn);
  assert.equal(ai365.calls.length, 1);
  const [{ url, init }] = ai365.calls;
  assert.equal(url, `${BASE}/api/sso/exchange`);
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["x-handoff-secret"], HANDOFF);
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body as string), { code: "abc123" });
});

it("callback: active staff (any case) gets a session and goes to next", async () => {
  const id = await newStaff("Mixed.Case@Lead.test");
  const ai365 = fakeAi365(200, {
    email: "mixed.case@LEAD.TEST",
    full_name: "Mixed",
  });
  const res = await finishSignIn(
    withState(`code=c&state=${STATE}`, "/deals?stage=won"),
    ai365.fetchFn,
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://crm.test/deals?stage=won");
  assertFlowCleared(res);
  const cookie = setCookies(res).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  )!;
  assert.match(
    cookie,
    /; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure$/,
  );
  assert.equal((await verifySession(sessionOf(res)))?.uid, id);

  const [u] = await db()`
    SELECT last_login_at > now() - interval '1 minute' AS fresh
    FROM app_user WHERE id = ${id}`;
  assert.equal(u.fresh, true);
  const [row] = await auditRows("sign_in");
  assert.equal(row.user_id, id);
  assert.deepEqual(row.after, { method: "ai365" });
  assert.equal(row.ip, "198.51.100.7");
});

it("callback: an unsafe stored next falls back to /people", async () => {
  await newStaff("next@lead.test");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "%E0"]) {
    const res = await finishSignIn(
      callback(`code=c&state=${STATE}`, {
        [STATE_COOKIE]: STATE,
        [NEXT_COOKIE]: bad === "%E0" ? bad : encodeURIComponent(bad),
      }),
      fakeAi365(200, { email: "next@lead.test" }).fetchFn,
    );
    assert.equal(res.headers.get("location"), "https://crm.test/people", bad);
  }
});

it("callback: an email not on the staff list → 403, no session, audited without the email", async () => {
  const res = await finishSignIn(
    withState(`code=c&state=${STATE}`),
    fakeAi365(200, { email: "learner@example.com", full_name: "L" }).fetchFn,
  );
  assert.equal(res.status, 403);
  assert.match(await res.text(), /No access to Lead CRM/);
  assert.equal(sessionOf(res), undefined);
  assertFlowCleared(res);
  const [row] = await auditRows("sign_in_failed");
  assert.equal(row.user_id, null);
  assert.equal(row.entity_id, null);
  assert.equal(JSON.stringify(row).includes("learner@example.com"), false);
});

it("callback: a deactivated user → 403, no session, last_login_at kept", async () => {
  const id = await newStaff("gone@lead.test", false);
  const res = await finishSignIn(
    withState(`code=c&state=${STATE}`),
    fakeAi365(200, { email: "gone@lead.test" }).fetchFn,
  );
  assert.equal(res.status, 403);
  assert.equal(sessionOf(res), undefined);
  const [u] = await db()`SELECT last_login_at FROM app_user WHERE id = ${id}`;
  assert.equal(u.last_login_at, null);
  assert.equal((await auditRows("sign_in_failed"))[0].user_id, null);
});

it("dev sign-in: a session for DEV_USER_ID, audited as dev", async () => {
  const id = await newStaff("dev@lead.test");
  Object.assign(process.env, { NODE_ENV: "development", DEV_USER_ID: id });
  const res = await devSignIn(
    new Request("http://localhost:3000/auth/dev-sign-in", { method: "POST" }),
  );
  assert.equal(res.status, 303);
  assert.equal((await verifySession(sessionOf(res)))?.uid, id);
  const [row] = await auditRows("sign_in");
  assert.equal(row.user_id, id);
  assert.deepEqual(row.after, { method: "dev" });
});

it("dev sign-in: a deactivated DEV_USER_ID gets no session", async () => {
  const id = await newStaff("devgone@lead.test", false);
  Object.assign(process.env, { NODE_ENV: "development", DEV_USER_ID: id });
  const res = await devSignIn(
    new Request("http://localhost:3000/auth/dev-sign-in", { method: "POST" }),
  );
  assert.equal(res.status, 403);
  assert.equal(sessionOf(res), undefined);
});
