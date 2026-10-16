// Integration tests for the §11.1 event contract: raiseEvent writes one
// event_outbox row and joins the caller's transaction. Skipped when
// DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { raiseEvent } from "../lib/events/raise.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const adminId = SEED_USERS.admin;

const rowsFor = (id: string) =>
  db()`SELECT type, aggregate_type, payload, processed_at, attempts, created_by
       FROM event_outbox WHERE aggregate_id = ${id}`;

it("raiseEvent inserts one outbox row", async () => {
  const classId = crypto.randomUUID();
  await raiseEvent("ClassPublished", classId, { classId }, adminId);
  const rows = await rowsFor(classId);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0] },
    {
      type: "ClassPublished",
      aggregate_type: "class",
      payload: { classId },
      processed_at: null,
      attempts: 0,
      created_by: adminId,
    },
  );
});

it("raiseEvent with a null actor leaves created_by null", async () => {
  const classId = crypto.randomUUID();
  await raiseEvent("ClassPublished", classId, { classId }, null);
  const [row] = await rowsFor(classId);
  assert.equal(row.created_by, null);
});

test(
  "raiseEvent joins the caller's transaction",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    const classId = crypto.randomUUID();
    await rollbackAfter(async () => {
      await raiseEvent("ClassPublished", classId, { classId }, adminId);
      assert.equal((await rowsFor(classId)).length, 1);
    });
    // Outside the transaction now: db() is the root pool.
    assert.equal((await rowsFor(classId)).length, 0);
  },
);
