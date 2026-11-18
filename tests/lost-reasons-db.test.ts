// Spec §9.15 Lost reasons against the database: create (duplicate code, last
// place, audit), update (If-Match, deactivation keeps deals), reorder
// (design 7: the complete list or nothing). Rolled back. Skipped without
// DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import { listLostReasons } from "../lib/deals/service.ts";
import {
  createLostReason,
  listAllLostReasons,
  reorderLostReasons,
  updateLostReason,
} from "../lib/settings/lost-reasons.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

const input = (code: string, labelEn = "Budget frozen") => ({
  code,
  labelEn,
  labelZh: null,
});

const auditFor = async (entityId: string | null, action: string) =>
  await db()`
    SELECT user_id, before, after FROM audit_log
    WHERE entity = 'lost_reason' AND action = ${action}
      AND entity_id IS NOT DISTINCT FROM ${entityId}`;

it("create: goes last, active, with a create audit row", async () => {
  const admin = await newUser("super_admin");
  const r = await createLostReason(input("budget_frozen"), admin);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  const all = await listAllLostReasons();
  assert.equal(all.at(-1)!.id, r.reason.id);
  assert.equal(r.reason.isActive, true);
  assert.equal(r.reason.dealCount, 0);
  assert.equal(r.reason.version, 1);
  assert.ok((await listLostReasons()).some((x) => x.id === r.reason.id));
  const [row] = await auditFor(r.reason.id, "create");
  assert.equal(row.user_id, admin.id);
  assert.equal(row.after.code, "budget_frozen");
});

it("create: a code already in use is duplicate_code", async () => {
  const admin = await newUser("super_admin");
  assert.equal(
    (await createLostReason(input("price"), admin)).kind,
    "duplicate_code",
  );
});

it("update: deactivating drops it from the Lost dialog, deals keep it", async () => {
  const admin = await newUser("super_admin");
  const created = await createLostReason(input("oct_freeze"), admin);
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") return;
  const id = created.reason.id;
  const person = await newPerson("Lost Person");
  const [deal] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, lost_at, lost_reason_id)
    VALUES ('individual', 'lost', ${person}, now(), ${id}) RETURNING id`;

  const r = await updateLostReason(id, { isActive: false }, 1, admin);
  assert.equal(r.kind, "ok");
  assert.equal(r.kind === "ok" && r.reason.dealCount, 1);
  assert.equal(
    (await listLostReasons()).some((x) => x.id === id),
    false,
  );
  const [d] = await db()`SELECT lost_reason_id FROM deal WHERE id = ${deal.id}`;
  assert.equal(d.lost_reason_id, id);
  const [row] = await auditFor(id, "update");
  assert.deepEqual(row.before, { isActive: true });
  assert.deepEqual(row.after, { isActive: false });
});

it("update: rename keeps the code; only changed fields are audited", async () => {
  const admin = await newUser("super_admin");
  const [price] = await db()`SELECT id, version FROM lost_reason WHERE code = 'price'`;
  const r = await updateLostReason(
    price.id,
    { labelEn: "Price too high", labelZh: null, isActive: true },
    Number(price.version),
    admin,
  );
  assert.equal(r.kind === "ok" && r.reason.code, "price");
  assert.equal(r.kind === "ok" && r.reason.labelEn, "Price too high");
  const [row] = await auditFor(price.id, "update");
  assert.deepEqual(row.after, { labelEn: "Price too high" });
});

it("update: a stale version or a missing reason is refused", async () => {
  const admin = await newUser("super_admin");
  const [price] = await db()`SELECT id, version FROM lost_reason WHERE code = 'price'`;
  assert.equal(
    (
      await updateLostReason(
        price.id,
        { labelEn: "X" },
        Number(price.version) + 1,
        admin,
      )
    ).kind,
    "stale",
  );
  assert.equal(
    (await updateLostReason(crypto.randomUUID(), { labelEn: "X" }, 1, admin))
      .kind,
    "not_found",
  );
});

const currentOrder = async () =>
  (await listAllLostReasons()).map((r) => r.id);

it("reorder: the complete list is saved in that order, one audit row", async () => {
  const admin = await newUser("super_admin");
  const before = await currentOrder();
  const wanted = [...before].reverse();
  assert.equal((await reorderLostReasons(wanted, admin)).kind, "ok");
  assert.deepEqual(await currentOrder(), wanted);
  const rows = await auditFor(null, "update");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].before, { order: before });
  assert.deepEqual(rows[0].after, { order: wanted });
});

it("reorder: a missing, repeated or unknown id changes nothing", async () => {
  const admin = await newUser("super_admin");
  const ids = await currentOrder();
  const bad = [
    ids.slice(1),
    [...ids, ids[0]],
    // Same length: the first repeated, the last left out.
    [ids[0], ...ids.slice(0, -1)],
    [...ids.slice(1), crypto.randomUUID()],
  ];
  for (const list of bad)
    assert.equal((await reorderLostReasons(list, admin)).kind, "incomplete");
  assert.deepEqual(await currentOrder(), ids);
  assert.equal((await auditFor(null, "update")).length, 0);
});
