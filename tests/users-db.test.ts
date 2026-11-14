// Spec §9.15 Users against the database: the list's statuses and order, and
// PATCH /api/users/:id's If-Match, self-change and last-super_admin rules
// with their audit rows (design 6). Every test makes its own users inside a
// rolled-back transaction, except the concurrency test, which needs two
// committed connections and cleans up after itself. Skipped without
// DATABASE_URL.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Role, Viewer } from "../lib/auth/permissions.ts";
import { closeDb, db, withTransaction } from "../lib/sql.ts";
import { listUsers, updateUser } from "../lib/users/service.ts";
import { it } from "./seed.ts";

after(closeDb);

async function addUser(
  name: string,
  role: Role,
  opts: { active?: boolean; lastLogin?: boolean } = {},
): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code, is_active, last_login_at)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, ${name}, ${role},
            ${opts.active ?? true}, ${opts.lastLogin ? db()`now()` : null})
    RETURNING id`;
  return { id: u.id, role };
}

const versionOf = async (id: string) =>
  Number((await db()`SELECT version FROM app_user WHERE id = ${id}`)[0].version);

const auditFor = async (id: string) =>
  await db()`
    SELECT user_id, action, entity, before, after FROM audit_log
    WHERE entity = 'app_user' AND entity_id = ${id} ORDER BY at, id`;

// Only `keep` stays an active super_admin, so the last-one rule can bite.
const onlySuperAdmins = async (...keep: string[]) =>
  await db()`
    UPDATE app_user SET is_active = false
    WHERE role_code = 'super_admin' AND is_active AND NOT (id = ANY(${keep}))`;

// --- listUsers (2.2) --------------------------------------------------------

it("list: Active, Not signed in yet and Deactivated, with the version", async () => {
  const active = await addUser("Zz Active", "sales", { lastLogin: true });
  const fresh = await addUser("Zz Fresh", "support");
  const gone = await addUser("Aa Gone", "sales", {
    active: false,
    lastLogin: true,
  });
  const rows = await listUsers();
  const row = (id: string) => rows.find((r) => r.id === id)!;
  assert.equal(row(active.id).status, "active");
  assert.ok(row(active.id).lastLoginAt);
  assert.equal(row(fresh.id).status, "not_signed_in");
  assert.equal(row(fresh.id).lastLoginAt, null);
  assert.equal(row(gone.id).status, "deactivated");
  assert.equal(row(fresh.id).version, 1);
  assert.equal(row(fresh.id).roleCode, "support");
  assert.equal(row(fresh.id).employmentType, "full_time");
});

it("list: sorted by name, deactivated users last", async () => {
  const b = await addUser("Bb Middle", "sales");
  const a = await addUser("aa first", "sales");
  const gone = await addUser("Aa Gone", "sales", { active: false });
  const rows = await listUsers();
  const at = (id: string) => rows.findIndex((r) => r.id === id);
  assert.ok(at(a.id) < at(b.id));
  const lastActive = Math.max(
    ...rows.filter((r) => r.status !== "deactivated").map((r) => at(r.id)),
  );
  assert.ok(at(gone.id) > lastActive);
});

// --- updateUser (2.4) -------------------------------------------------------

it("update: a role change saves and writes permission_change", async () => {
  const admin = await addUser("Admin", "super_admin");
  const target = await addUser("Lim Wei", "sales");
  const r = await updateUser(target.id, { roleCode: "operations" }, 1, admin);
  assert.equal(r.kind, "ok");
  assert.equal(r.kind === "ok" && r.user.roleCode, "operations");
  assert.equal(r.kind === "ok" && r.user.version, 2);
  const rows = await auditFor(target.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "permission_change");
  assert.equal(rows[0].user_id, admin.id);
  assert.deepEqual(rows[0].before, { roleCode: "sales" });
  assert.deepEqual(rows[0].after, { roleCode: "operations" });
});

it("update: other changes write update with only the changed fields", async () => {
  const admin = await addUser("Admin", "super_admin");
  const target = await addUser("Lim Wei", "sales");
  const r = await updateUser(
    target.id,
    { employmentType: "part_time", isActive: true },
    1,
    admin,
  );
  assert.equal(r.kind, "ok");
  const rows = await auditFor(target.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "update");
  // isActive was already true, so it is not a change.
  assert.deepEqual(rows[0].before, { employmentType: "full_time" });
  assert.deepEqual(rows[0].after, { employmentType: "part_time" });
});

it("update: deactivate then reactivate", async () => {
  const admin = await addUser("Admin", "super_admin");
  const target = await addUser("Lim Wei", "sales", { lastLogin: true });
  const off = await updateUser(target.id, { isActive: false }, 1, admin);
  assert.equal(off.kind === "ok" && off.user.status, "deactivated");
  const on = await updateUser(target.id, { isActive: true }, 2, admin);
  assert.equal(on.kind === "ok" && on.user.status, "active");
  // One transaction, so both rows share `at`: compare without order.
  const rows = await auditFor(target.id);
  assert.deepEqual(
    rows.map((r) => JSON.stringify([r.action, r.after])).sort(),
    [
      JSON.stringify(["update", { isActive: false }]),
      JSON.stringify(["update", { isActive: true }]),
    ],
  );
});

it("update: a stale version is refused and changes nothing", async () => {
  const admin = await addUser("Admin", "super_admin");
  const target = await addUser("Lim Wei", "sales");
  await updateUser(target.id, { employmentType: "part_time" }, 1, admin);
  const r = await updateUser(target.id, { roleCode: "support" }, 1, admin);
  assert.equal(r.kind, "stale");
  const [row] = await db()`SELECT role_code FROM app_user WHERE id = ${target.id}`;
  assert.equal(row.role_code, "sales");
});

it("update: a missing user or a bad id is not found", async () => {
  const admin = await addUser("Admin", "super_admin");
  const missing = crypto.randomUUID();
  assert.equal(
    (await updateUser(missing, { isActive: false }, 1, admin)).kind,
    "not_found",
  );
  assert.equal(
    (await updateUser("abc", { isActive: false }, 1, admin)).kind,
    "not_found",
  );
});

it("update: nobody changes their own role or deactivates themselves", async () => {
  const admin = await addUser("Admin", "super_admin");
  await addUser("Other admin", "super_admin");
  const v = await versionOf(admin.id);
  assert.equal(
    (await updateUser(admin.id, { roleCode: "sales" }, v, admin)).kind,
    "self_change",
  );
  assert.equal(
    (await updateUser(admin.id, { isActive: false }, v, admin)).kind,
    "self_change",
  );
  // Their own employment type is fine.
  assert.equal(
    (await updateUser(admin.id, { employmentType: "part_time" }, v, admin))
      .kind,
    "ok",
  );
  assert.equal((await auditFor(admin.id)).length, 1);
});

it("update: the last active super_admin can't be demoted or deactivated", async () => {
  const viewer = await addUser("Viewer", "super_admin");
  const last = await addUser("Last", "super_admin");
  await onlySuperAdmins(last.id);
  assert.equal(
    (await updateUser(last.id, { roleCode: "management" }, 1, viewer)).kind,
    "last_super_admin",
  );
  assert.equal(
    (await updateUser(last.id, { isActive: false }, 1, viewer)).kind,
    "last_super_admin",
  );
  assert.equal((await auditFor(last.id)).length, 0);
  // With a second active super_admin, the same demotion goes through.
  await db()`UPDATE app_user SET is_active = true WHERE id = ${viewer.id}`;
  assert.equal(
    (await updateUser(last.id, { roleCode: "management" }, 1, viewer)).kind,
    "ok",
  );
});

// Design 6: two super_admins demote each other at the same moment, on two
// connections. The advisory lock serialises them, so the second sees the
// first and is refused. Committed data, so it restores what it changed.
test(
  "update: two concurrent demotions of the last two super_admins, one wins",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    const sql = db();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const others = await sql`
      SELECT id FROM app_user WHERE role_code = 'super_admin' AND is_active`;
    await sql`
      INSERT INTO app_user (id, email, full_name, role_code)
      SELECT unnest(${ids}::uuid[]), gen_random_uuid() || '@lead.test',
             'Race admin', 'super_admin'`;
    try {
      await sql`UPDATE app_user SET is_active = false
                WHERE id = ANY(${others.map((r) => r.id)})`;
      // The audit rows name a seeded admin as the actor, so the two race
      // users carry no audit reference and can be deleted afterwards.
      const actor: Viewer = { id: others[0]?.id ?? ids[0], role: "super_admin" };
      // The first demotion stays uncommitted for a moment after it runs, so
      // the second one starts while the first is still open. The second is
      // started from the test's own context, not inside the first's
      // transaction, so it gets its own connection.
      let firstRan!: () => void;
      const ran = new Promise<void>((r) => (firstRan = r));
      const first = withTransaction(async () => {
        const r = await updateUser(ids[0], { roleCode: "sales" }, 1, actor);
        firstRan();
        await new Promise((r) => setTimeout(r, 300));
        return r;
      });
      await ran;
      const second = updateUser(ids[1], { roleCode: "sales" }, 1, actor);
      const results = await Promise.all([first, second]);
      const kinds = results.map((r) => r.kind).sort();
      assert.deepEqual(kinds, ["last_super_admin", "ok"]);
    } finally {
      await sql`UPDATE app_user SET is_active = true
                WHERE id = ANY(${others.map((r) => r.id)})`;
      await sql`DELETE FROM app_user WHERE id = ANY(${ids})`;
    }
  },
);
