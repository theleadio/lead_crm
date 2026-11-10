// The LMS sync's cut-over cancel (scripts/sync-lms.ts): each import seat it
// cancels gets one audit_log row and one EnrolmentCancelled event, a re-run
// writes nothing more, and seats that are not cancellable are left alone.
import { after } from "node:test";
import assert from "node:assert/strict";
import { CUT_OVER_REASON, cancelCutOver } from "../lib/import/lms-adopt.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass } from "./seed.ts";

after(closeDb);

async function written(ids: string[]) {
  const sql = db();
  const audits = await sql`
    SELECT entity_id, user_id, before, after FROM audit_log
    WHERE entity = 'enrolment' AND entity_id = ANY(${ids})`;
  const events = await sql`
    SELECT aggregate_id, payload FROM event_outbox
    WHERE type = 'EnrolmentCancelled' AND aggregate_id = ANY(${ids})`;
  return { audits, events };
}

it("cancels cancellable seats with one audit row and one event each", async () => {
  const classId = await newClass({ capacity: 10 });
  const confirmed = await enrol(classId, "confirmed");
  const pending = await enrol(classId, "payment_pending");
  const cut = [confirmed, pending];

  assert.deepEqual((await cancelCutOver(db(), cut)).sort(), [...cut].sort());

  const rows = await db()`
    SELECT id, status, cancelled_reason FROM enrolment WHERE id = ANY(${cut})`;
  for (const r of rows) {
    assert.equal(r.status, "cancelled");
    assert.equal(r.cancelled_reason, CUT_OVER_REASON);
  }

  const { audits, events } = await written(cut);
  assert.equal(audits.length, 2);
  assert.equal(events.length, 2);
  const was = new Map(audits.map((a) => [a.entity_id, a.before.status]));
  assert.equal(was.get(confirmed), "confirmed");
  assert.equal(was.get(pending), "payment_pending");
  for (const a of audits) {
    assert.equal(a.user_id, null);
    assert.equal(a.after.status, "cancelled");
    assert.equal(a.after.by, "sync-lms");
  }
  for (const e of events) {
    assert.equal(e.payload.enrolmentId, e.aggregate_id);
    assert.match(e.payload.reason, /^Not in the LMS at class start\./);
  }
});

it("writes nothing more on a re-run", async () => {
  const classId = await newClass();
  const seat = await enrol(classId, "confirmed");
  await cancelCutOver(db(), [seat]);

  assert.deepEqual(await cancelCutOver(db(), [seat]), []);
  const { audits, events } = await written([seat]);
  assert.equal(audits.length, 1);
  assert.equal(events.length, 1);
});

it("leaves cancelled, attended and completed seats alone", async () => {
  const classId = await newClass();
  const seats = await Promise.all(
    ["cancelled", "attended", "completed"].map((s) => enrol(classId, s)),
  );

  assert.deepEqual(await cancelCutOver(db(), seats), []);
  const rows = await db()`
    SELECT status FROM enrolment WHERE id = ANY(${seats}) ORDER BY status`;
  assert.deepEqual(rows.map((r) => r.status), ["attended", "cancelled", "completed"]);
  const { audits, events } = await written(seats);
  assert.equal(audits.length + events.length, 0);
});

it("does nothing for an empty list", async () => {
  assert.deepEqual(await cancelCutOver(db(), []), []);
});
