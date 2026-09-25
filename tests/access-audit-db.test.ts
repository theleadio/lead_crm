// Audit of permission denials and sign-in (spec §6, §13, §14). DB tests run in
// a rolled-back transaction; skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { forbidden } from "../lib/api/errors.ts";
import { canWriteCompany, type Viewer } from "../lib/auth/permissions.ts";
import {
  safeNext,
  signIn,
  signOut,
  type AuthClient,
} from "../lib/auth/sign-in.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };

const denials = async (userId: string) =>
  await db()`
    SELECT action, entity, after, host(ip) AS ip FROM audit_log
    WHERE user_id = ${userId} AND action = 'permission_denied'`;

// The company PATCH route runs exactly this: canWriteCompany, else forbidden().
const patchCompany = async (viewer: Viewer, ip?: string) => {
  const request = new Request("http://localhost/api/companies/abc", {
    method: "PATCH",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
  if (canWriteCompany(viewer)) return null;
  return forbidden(viewer, request, {
    what: "edit companies",
    resource: "company",
  });
};

it("403: a denied marketing call writes one permission_denied row", async () => {
  const res = await patchCompany(marketing, "203.0.113.7, 10.0.0.1");
  assert.equal(res?.status, 403);
  const body = await res!.json();
  assert.equal(body.error.code, "forbidden");
  assert.equal(
    body.error.message,
    "You don't have access to edit companies. Ask a super admin if you need it.",
  );
  const rows = await denials(marketing.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, "company");
  assert.deepEqual(rows[0].after, {
    route: "/api/companies/abc",
    method: "PATCH",
  });
  assert.equal(rows[0].ip, "203.0.113.7");
});

it("403: an allowed sales call writes no denial row", async () => {
  assert.equal(await patchCompany(sales), null);
  assert.equal((await denials(sales.id)).length, 0);
});

it("403: a junk x-forwarded-for is stored as no ip, still 403", async () => {
  const res = await patchCompany(marketing, "not-an-ip");
  assert.equal(res?.status, 403);
  assert.equal((await denials(marketing.id))[0].ip, null);
});

// Sign-in, with the Supabase call stubbed. Only the password check differs.
const stub = (goodPassword: string | null): AuthClient => ({
  auth: {
    signInWithPassword: async ({ password }) => ({
      error: password === goodPassword ? null : new Error("bad"),
    }),
    signOut: async () => ({}),
  },
});
const STAFF_EMAIL = async () =>
  (await db()`SELECT email FROM app_user WHERE id = ${sales.id}`)[0]
    .email as string;
const failRows = async () =>
  await db()`
    SELECT user_id, entity_id, before, after FROM audit_log
    WHERE action = 'sign_in_failed' ORDER BY at DESC`;
const failNTimes = async (email: string, n: number) => {
  for (let i = 0; i < n; i++) await signIn(email, "wrong", null, stub("right"));
};
const insertFailure = async (minutesAgo: number) =>
  await db()`
    INSERT INTO audit_log (user_id, action, at)
    VALUES (${sales.id}, 'sign_in_failed', now() - make_interval(mins => ${minutesAgo}))`;

it("sign-in: success writes sign_in with the ip", async () => {
  const email = await STAFF_EMAIL();
  const r = await signIn(email, "right", "198.51.100.4", stub("right"));
  assert.deepEqual(r, { ok: true });
  const [row] = await db()`
    SELECT user_id, host(ip) AS ip FROM audit_log
    WHERE action = 'sign_in' AND user_id = ${sales.id}`;
  assert.equal(row.ip, "198.51.100.4");
});

it("sign-in: unknown email stores no email and no user", async () => {
  const r = await signIn("nobody@example.com", "x", null, stub("right"));
  assert.deepEqual(r, {
    ok: false,
    error: "Wrong email or password. Try again.",
  });
  const [row] = await failRows();
  assert.equal(row.user_id, null);
  assert.equal(JSON.stringify(row).includes("nobody@example.com"), false);
});

it("sign-in: 5 failures lock the 6th attempt even with the right password", async () => {
  const email = await STAFF_EMAIL();
  const before = (await failRows()).length;
  await failNTimes(email, 5);
  const r = await signIn(email, "right", null, stub("right"));
  assert.equal(r.ok, false);
  assert.match(
    !r.ok ? r.error : "",
    /^Too many attempts\. Try again in \d+ minutes?\.$/,
  );
  // A refused attempt is not itself a failure row, so the window can end.
  assert.equal((await failRows()).length, before + 5);
});

it("sign-in: 4 failures don't lock", async () => {
  const email = await STAFF_EMAIL();
  await failNTimes(email, 4);
  assert.deepEqual(await signIn(email, "right", null, stub("right")), {
    ok: true,
  });
});

it("sign-in: failures older than 15 minutes don't count", async () => {
  const email = await STAFF_EMAIL();
  for (const m of [16, 20, 30, 40, 50]) await insertFailure(m);
  assert.deepEqual(await signIn(email, "right", null, stub("right")), {
    ok: true,
  });
});

it("sign-in: lock message says minutes until the 5th-newest failure expires", async () => {
  const email = await STAFF_EMAIL();
  for (const m of [1, 2, 3, 4, 14]) await insertFailure(m);
  const locked = await signIn(email, "right", null, stub("right"));
  assert.match(!locked.ok ? locked.error : "", /in 1 minute\./);
});

it("sign-out: writes sign_out for the session user", async () => {
  await signOut({ id: sales.id }, "198.51.100.9", stub(null));
  const [row] = await db()`
    SELECT host(ip) AS ip FROM audit_log
    WHERE action = 'sign_out' AND user_id = ${sales.id}`;
  assert.equal(row.ip, "198.51.100.9");
});

test("safeNext: only same-site paths", () => {
  assert.equal(safeNext("/deals?x=1"), "/deals?x=1");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", null])
    assert.equal(safeNext(bad), "/people");
});
