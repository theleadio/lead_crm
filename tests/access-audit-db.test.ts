// Audit of permission denials and sign-in (spec §6, §13, §14). DB tests run in
// a rolled-back transaction; skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { forbidden } from "../lib/api/errors.ts";
import { canWriteCompany, type Viewer } from "../lib/auth/permissions.ts";
import { safeNext, signIn, signOut } from "../lib/auth/sign-in.ts";
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

// Sign-in: AI365 has already said who they are; this is the allowlist check.
// The callback's own tests are in ai365-callback-db.test.ts.
const STAFF_EMAIL = async () =>
  (await db()`SELECT email FROM app_user WHERE id = ${sales.id}`)[0]
    .email as string;
const failRows = async () =>
  await db()`
    SELECT user_id, entity_id, before, after FROM audit_log
    WHERE action = 'sign_in_failed' ORDER BY at DESC`;

it("sign-in: success writes sign_in with the ip and the method", async () => {
  const email = await STAFF_EMAIL();
  assert.equal(await signIn({ email }, "ai365", "198.51.100.4"), sales.id);
  const [row] = await db()`
    SELECT host(ip) AS ip, after FROM audit_log
    WHERE action = 'sign_in' AND user_id = ${sales.id}`;
  assert.equal(row.ip, "198.51.100.4");
  assert.deepEqual(row.after, { method: "ai365" });
});

it("sign-in: success sets last_login_at", async () => {
  await db()`UPDATE app_user SET last_login_at = NULL WHERE id = ${sales.id}`;
  await signIn({ email: await STAFF_EMAIL() }, "ai365", null);
  const [u] = await db()`
    SELECT last_login_at > now() - interval '1 minute' AS fresh
    FROM app_user WHERE id = ${sales.id}`;
  assert.equal(u.fresh, true);
});

it("sign-in: unknown email stores no email and no user", async () => {
  assert.equal(
    await signIn({ email: "nobody@example.com" }, "ai365", null),
    null,
  );
  const [row] = await failRows();
  assert.equal(row.user_id, null);
  assert.equal(JSON.stringify(row).includes("nobody@example.com"), false);
});

it("sign-in: a deactivated user is refused and last_login_at stays", async () => {
  await db()`UPDATE app_user SET is_active = false, last_login_at = NULL
             WHERE id = ${sales.id}`;
  assert.equal(
    await signIn({ email: await STAFF_EMAIL() }, "ai365", null),
    null,
  );
  const [u] =
    await db()`SELECT last_login_at FROM app_user WHERE id = ${sales.id}`;
  assert.equal(u.last_login_at, null);
  assert.equal((await failRows())[0].user_id, null);
});

it("sign-out: writes sign_out for the session user", async () => {
  await signOut({ id: sales.id }, "198.51.100.9");
  const [row] = await db()`
    SELECT host(ip) AS ip FROM audit_log
    WHERE action = 'sign_out' AND user_id = ${sales.id}`;
  assert.equal(row.ip, "198.51.100.9");
});

test("safeNext: only same-site paths", () => {
  assert.equal(safeNext("/deals?x=1"), "/deals?x=1");
  const bads = ["//evil.com", "/\\evil.com", "https://evil.com", "", null];
  // Browsers drop tab, CR and LF from a URL, which turns these into //evil.com.
  bads.push("/\t/evil.com", "/\n/evil.com", "/\r\\evil.com", "/\t\\evil.com");
  for (const bad of bads) assert.equal(safeNext(bad), "/people", String(bad));
});
