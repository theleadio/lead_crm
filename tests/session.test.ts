// The CRM's signed session cookie (lib/auth/session.ts), the proxy that gates
// the CRM screens on it, and the dev sign-in route's production 404. No
// database needed.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  cookieHeader,
  signSession,
  verifySession,
} from "../lib/auth/session.ts";
import { devSignIn } from "../lib/auth/flow.ts";
import { proxy } from "../proxy.ts";
import type { NextRequest } from "next/server";

const SECRET = "a".repeat(32);
const UID = "00000000-0000-4000-8000-000000000001";
const env = { ...process.env };

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...env };
});

const b64urlJson = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");

test("session: sign then verify gives the user back", async () => {
  const now = Date.UTC(2026, 10, 15, 9);
  const s = await verifySession(await signSession(UID, now), now + 1000);
  assert.equal(s?.uid, UID);
  assert.equal(s!.exp - s!.iat, SESSION_TTL);
  assert.equal(SESSION_TTL, 12 * 60 * 60);
});

test("session: a changed payload is refused", async () => {
  const [payload, sig] = (await signSession(UID)).split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forged = b64urlJson({ ...claims, uid: crypto.randomUUID() });
  assert.equal(await verifySession(`${forged}.${sig}`), null);
});

test("session: a changed signature is refused", async () => {
  const token = await signSession(UID);
  const [payload, sig] = token.split(".");
  // The first character: the last one carries padding bits that may not count.
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(await verifySession(`${payload}.${flipped}`), null);
  assert.equal(await verifySession(token + ".extra"), null);
  assert.equal(await verifySession("garbage"), null);
  assert.equal(await verifySession(undefined), null);
});

test("session: expired after 12 hours", async () => {
  const now = Date.now();
  const token = await signSession(UID, now);
  assert.ok(await verifySession(token, now + (SESSION_TTL - 1) * 1000));
  assert.equal(await verifySession(token, now + SESSION_TTL * 1000), null);
});

test("session: another secret's cookie is refused", async () => {
  const token = await signSession(UID);
  process.env.SESSION_SECRET = "b".repeat(32);
  assert.equal(await verifySession(token), null);
});

test("session: no secret, or a short one, fails closed", async () => {
  const token = await signSession(UID);
  for (const secret of [undefined, "short-secret"]) {
    if (secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = secret;
    await assert.rejects(signSession(UID), /SESSION_SECRET/);
    assert.equal(await verifySession(token), null);
  }
});

test("cookie: HttpOnly, Lax, Secure except on http://localhost in dev", () => {
  const local = new Request("http://localhost:3000/x");
  const live = new Request("https://theleadiocrm.netlify.app/x");
  const c = cookieHeader(live, SESSION_COOKIE, "v", SESSION_TTL);
  assert.equal(
    c,
    `${SESSION_COOKIE}=v; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure`,
  );
  process.env = { ...process.env, NODE_ENV: "development" };
  assert.doesNotMatch(cookieHeader(local, "n", "v", 1), /Secure/);
  process.env = { ...process.env, NODE_ENV: "production" };
  assert.match(cookieHeader(local, "n", "v", 1), /; Secure$/);
});

// The proxy reads only the URL and the Cookie header.
const visit = (path: string, cookie?: string) =>
  proxy(
    new Request(`https://crm.test${path}`, {
      headers: cookie ? { cookie } : {},
    }) as unknown as NextRequest,
  );

test("proxy: no cookie on a CRM screen → sign-in with next", async () => {
  const res = await visit("/deals/abc");
  assert.equal(res?.status, 302);
  assert.equal(
    res?.headers.get("location"),
    "https://crm.test/sign-in?next=%2Fdeals%2Fabc",
  );
});

test("proxy: a bad signature → sign-in", async () => {
  const token = await signSession(UID);
  const res = await visit("/people", `${SESSION_COOKIE}=${token}x`);
  assert.equal(res?.status, 302);
  assert.match(res?.headers.get("location") ?? "", /\/sign-in\?next=/);
});

test("proxy: without SESSION_SECRET in its runtime, any cookie passes (the layout verifies)", async () => {
  delete process.env.SESSION_SECRET;
  assert.equal(await visit("/people", `${SESSION_COOKIE}=whatever`), undefined);
  const res = await visit("/people");
  assert.equal(res?.status, 302);
});

test("proxy: a valid cookie passes; public paths need none", async () => {
  const token = await signSession(UID);
  assert.equal(
    await visit("/people", `other=1; ${SESSION_COOKIE}=${token}`),
    undefined,
  );
  for (const path of ["/sign-in", "/auth/ai365/callback?code=x", "/"])
    assert.equal(await visit(path), undefined, path);
});

test("dev sign-in: 404 in production even with DEV_USER_ID set", async () => {
  process.env = { ...process.env, NODE_ENV: "production", DEV_USER_ID: UID };
  const res = await devSignIn(
    new Request("https://crm.test/auth/dev-sign-in", { method: "POST" }),
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("dev sign-in: 404 without DEV_USER_ID", async () => {
  process.env = { ...process.env, NODE_ENV: "development" };
  delete process.env.DEV_USER_ID;
  const res = await devSignIn(
    new Request("http://localhost:3000/auth/dev-sign-in", { method: "POST" }),
  );
  assert.equal(res.status, 404);
});
