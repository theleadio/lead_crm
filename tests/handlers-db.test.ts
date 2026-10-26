// Spec §11.1 outbox handlers: the Ops tasks, the exclusions, idempotence,
// malformed payloads and runs through the real drain and registry.
// Rolled-back tests; skipped when DATABASE_URL isn't set.
import { after } from "node:test";
import assert from "node:assert/strict";
import { drainOutbox } from "../lib/events/drain.ts";
import { handlers, makeHandlers } from "../lib/events/handlers.ts";
import { raiseEvent } from "../lib/events/raise.ts";
import { myTasks } from "../lib/home/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newUser, pay } from "./seed.ts";

// Tests on the default registry must never reach the real Stripe port, even if
// the developer's shell has a key: remove it for this file, restore after.
const savedKey = process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;
after(() => {
  if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY = savedKey;
  return closeDb();
});

const event = (type: string, payload: unknown, id = crypto.randomUUID()) => ({
  id,
  type,
  aggregateId: crypto.randomUUID(),
  payload,
});
const tasksOf = (ids: string[]) =>
  db()`SELECT type, title, person_id, enrolment_id, assigned_user_id, source_key
       FROM task WHERE enrolment_id = ANY(${ids}::uuid[]) ORDER BY source_key`;
const spy = () => {
  const calls: string[] = [];
  return {
    calls,
    port: { expireCheckoutSession: async (s: string) => void calls.push(s) },
  };
};
// A deal carrying a Checkout session, attached to an enrolment.
async function withSession(enrolmentId: string, session: string) {
  const [e] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${enrolmentId}`;
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, checkout_session_id)
    VALUES ('individual', 'checkout_sent', ${e.person_id}, ${session})
    RETURNING id`;
  await db()`UPDATE enrolment SET deal_id = ${d.id} WHERE id = ${enrolmentId}`;
}
const parkOthers = () =>
  db()`UPDATE event_outbox SET processed_at = now() WHERE processed_at IS NULL`;

// ---- EnrolmentCancelled ----------------------------------------------------

it("EnrolmentCancelled: an Ops task for the enrolment, assigned to the duty super_admin and visible on their Home", async () => {
  // O37: Home lists only assigned tasks. Make our admin the duty one.
  const admin = await newUser("super_admin");
  await db()`UPDATE app_user SET is_active = false
              WHERE role_code = 'super_admin' AND id <> ${admin.id}`;
  const id = await enrol(await newClass(), "confirmed");
  await handlers.EnrolmentCancelled!(
    event("EnrolmentCancelled", { enrolmentId: id, reason: "student_request" }),
  );
  const t = await tasksOf([id]);
  assert.equal(t.length, 1);
  assert.equal(t[0].type, "other");
  assert.equal(t[0].assigned_user_id, admin.id);
  assert.ok((await myTasks(admin)).tasks.some((x) => x.title === t[0].title));
  const [e] = await db()`SELECT person_id FROM enrolment WHERE id = ${id}`;
  assert.equal(t[0].person_id, e.person_id);
});

it("EnrolmentCancelled: class_cancelled and reservation_expired do nothing", async () => {
  const id = await enrol(await newClass(), "confirmed");
  for (const reason of ["class_cancelled", "reservation_expired"])
    await handlers.EnrolmentCancelled!(
      event("EnrolmentCancelled", { enrolmentId: id, reason }),
    );
  assert.equal((await tasksOf([id])).length, 0);
});

it("EnrolmentCancelled: the same event twice is one task, a different event is another", async () => {
  const id = await enrol(await newClass(), "confirmed");
  const payload = { enrolmentId: id, reason: "student_request" };
  const e1 = event("EnrolmentCancelled", payload);
  await handlers.EnrolmentCancelled!(e1);
  await handlers.EnrolmentCancelled!(e1);
  assert.equal((await tasksOf([id])).length, 1);
  await handlers.EnrolmentCancelled!(event("EnrolmentCancelled", payload));
  assert.equal((await tasksOf([id])).length, 2);
});

it("EnrolmentCancelled: a closed task is not recreated by a repeat", async () => {
  const id = await enrol(await newClass(), "confirmed");
  const e1 = event("EnrolmentCancelled", {
    enrolmentId: id,
    reason: "student_request",
  });
  await handlers.EnrolmentCancelled!(e1);
  await db()`UPDATE task SET done_at = now() WHERE enrolment_id = ${id}`;
  await handlers.EnrolmentCancelled!(e1);
  assert.equal((await tasksOf([id])).length, 1);
});

it("EnrolmentCancelled: malformed payload or unknown enrolment throws", async () => {
  const h = handlers.EnrolmentCancelled!;
  await assert.rejects(h(event("EnrolmentCancelled", {})));
  await assert.rejects(h(event("EnrolmentCancelled", null)));
  await assert.rejects(
    h(event("EnrolmentCancelled", { enrolmentId: "nope", reason: "x" })),
  );
  await assert.rejects(
    h(
      event("EnrolmentCancelled", {
        enrolmentId: crypto.randomUUID(),
        reason: 7,
      }),
    ),
  );
  await assert.rejects(
    h(
      event("EnrolmentCancelled", {
        enrolmentId: crypto.randomUUID(),
        reason: "student_request",
      }),
    ),
    /not found/,
  );
});

// ---- ClassCancelled --------------------------------------------------------

// a: paid (its deal also has a session, which must NOT be expired).
// b: unpaid reservation with a session. c: unpaid, no deal.
// d: paid then fully refunded (nothing left to refund).
async function cancelledClass() {
  const cls = await newClass();
  const a = await enrol(cls, "confirmed");
  const b = await enrol(cls, "reserved");
  const c = await enrol(cls, "payment_pending");
  const d = await enrol(cls, "confirmed");
  await pay(a);
  await withSession(a, "cs_paid");
  await withSession(b, "cs_open");
  await db()`
    INSERT INTO payment (enrolment_id, method, status, amount_myr, paid_at,
                         refunded_amount_myr, refunded_at, match_status,
                         reference_no, proof_file_key)
    VALUES (${d}, 'bank_transfer', 'refunded', '500.00', now(), '500.00', now(),
            'matched', 'REF-2', 'proofs/x.pdf')`;
  return { cls, a, ids: [a, b, c, d] };
}

it("ClassCancelled: a tell-once task each, a refund task only where money is held, the open link of an unpaid reservation expired", async () => {
  const { cls, a, ids } = await cancelledClass();
  const s = spy();
  await makeHandlers(s.port).ClassCancelled!(
    event("ClassCancelled", {
      classId: cls,
      reason: "Trainer ill",
      enrolmentIds: ids,
    }),
  );
  const t = await tasksOf(ids);
  assert.equal(t.filter((x) => x.title.endsWith("tell the student")).length, 4);
  const refunds = t.filter((x) => x.title.endsWith("refund needed"));
  assert.deepEqual(
    refunds.map((x) => x.enrolment_id),
    [a],
  );
  assert.equal(t.length, 5);
  assert.ok(
    t.every((x) => x.assigned_user_id),
    "every task has an assignee",
  );
  assert.deepEqual(s.calls, ["cs_open"]);
});

it("ClassCancelled: the same event twice leaves the same tasks", async () => {
  const { cls, ids } = await cancelledClass();
  const h = makeHandlers(spy().port).ClassCancelled!;
  const e1 = event("ClassCancelled", {
    classId: cls,
    reason: "x",
    enrolmentIds: ids,
  });
  await h(e1);
  const first = await tasksOf(ids);
  await h(e1);
  assert.deepEqual(await tasksOf(ids), first);
  assert.equal(first.length, 5);
});

it("ClassCancelled: an empty list does nothing; a repeated id counts once", async () => {
  const { cls, a } = await cancelledClass();
  const h = makeHandlers(spy().port).ClassCancelled!;
  await h(
    event("ClassCancelled", { classId: cls, reason: "x", enrolmentIds: [] }),
  );
  assert.equal((await tasksOf([a])).length, 0);
  await h(
    event("ClassCancelled", {
      classId: cls,
      reason: "x",
      enrolmentIds: [a, a],
    }),
  );
  assert.equal((await tasksOf([a])).length, 2); // tell + refund
});

it("ClassCancelled: the default port is a no-op without a key", async () => {
  const { cls, ids } = await cancelledClass();
  await handlers.ClassCancelled!(
    event("ClassCancelled", { classId: cls, reason: "x", enrolmentIds: ids }),
  );
  assert.equal((await tasksOf(ids)).length, 5); // no manual-expire task
});

it("ClassCancelled: malformed payload or an unknown enrolment throws", async () => {
  const h = handlers.ClassCancelled!;
  const cls = crypto.randomUUID();
  await assert.rejects(h(event("ClassCancelled", { classId: cls })));
  await assert.rejects(
    h(
      event("ClassCancelled", {
        classId: cls,
        reason: "x",
        enrolmentIds: "e",
      }),
    ),
  );
  await assert.rejects(
    h(
      event("ClassCancelled", {
        classId: cls,
        reason: "x",
        enrolmentIds: ["nope"],
      }),
    ),
  );
  await assert.rejects(
    h(
      event("ClassCancelled", {
        classId: cls,
        reason: "x",
        enrolmentIds: [crypto.randomUUID()],
      }),
    ),
    /does not exist/,
  );
});

// ---- ClassChanged ----------------------------------------------------------

it("ClassChanged: a validated no-op (no schedule cache exists yet)", async () => {
  const count = async () =>
    (await db()`SELECT count(*)::int AS n FROM task`)[0].n;
  const before = await count();
  const classId = crypto.randomUUID();
  const h = handlers.ClassChanged!;
  await h(
    event("ClassChanged", {
      classId,
      changedFields: { venue_name: "x" },
      noticeId: null,
    }),
  );
  await h(
    event("ClassChanged", {
      classId,
      changedFields: {},
      noticeId: crypto.randomUUID(),
    }),
  );
  assert.equal(await count(), before);
  await assert.rejects(
    h(event("ClassChanged", { changedFields: {}, noticeId: null })),
  );
  await assert.rejects(
    h(event("ClassChanged", { classId, changedFields: [], noticeId: null })),
  );
});

// ---- through the real drain and registry -----------------------------------

it("drain: the real registry turns EnrolmentCancelled into one task and closes the event; a revived repeat adds none", async () => {
  await parkOthers();
  const id = await enrol(await newClass(), "confirmed");
  await raiseEvent(
    "EnrolmentCancelled",
    id,
    { enrolmentId: id, reason: "student_request" },
    null,
  );
  const r = await drainOutbox();
  assert.deepEqual(r, { claimed: 1, processed: 1, failed: 0, dead: 0 });
  assert.equal((await tasksOf([id])).length, 1);
  // Revived, as retryDeadEvents() or a re-run batch would:
  await db()`UPDATE event_outbox SET processed_at = NULL, attempts = 0
             WHERE aggregate_id = ${id}`;
  assert.equal((await drainOutbox()).processed, 1);
  assert.equal((await tasksOf([id])).length, 1);
});

it("drain: ClassCancelled through the registry; a malformed event fails, keeps its error and writes nothing", async () => {
  await parkOthers();
  const { cls, ids } = await cancelledClass();
  await raiseEvent(
    "ClassCancelled",
    cls,
    { classId: cls, reason: "x", enrolmentIds: ids },
    null,
  );
  const bad = crypto.randomUUID();
  await raiseEvent(
    "EnrolmentCancelled",
    bad,
    { enrolmentId: bad } as never,
    null,
  );
  const r = await drainOutbox();
  assert.deepEqual(r, { claimed: 2, processed: 1, failed: 1, dead: 0 });
  assert.equal((await tasksOf(ids)).length, 5);
  const [row] = await db()`
    SELECT attempts, last_error, processed_at FROM event_outbox
    WHERE aggregate_id = ${bad}`;
  assert.equal(row.attempts, 1);
  assert.equal(row.processed_at, null);
  assert.ok(row.last_error);
});

it("ClassCancelled: a failing expire call keeps every notice and refund task and adds one manual-expire task, once even on replay", async () => {
  const admin = await newUser("super_admin");
  await db()`UPDATE app_user SET is_active = false
              WHERE role_code = 'super_admin' AND id <> ${admin.id}`;
  const { cls, ids } = await cancelledClass();
  const ev = event("ClassCancelled", {
    classId: cls,
    reason: "x",
    enrolmentIds: ids,
  });
  // 500, 401 and a bare network failure: none may throw.
  for (const status of [500, 401, undefined]) {
    const h = makeHandlers({
      expireCheckoutSession: async () => {
        throw Object.assign(new Error("stripe down"), { status });
      },
    }).ClassCancelled!;
    await h(ev);
    await h(ev); // replay
    const t = await tasksOf(ids);
    assert.equal(t.length, 6); // 4 tell + 1 refund + 1 manual expire
    const manual = t.filter((x) => x.title.includes("by hand"));
    assert.equal(manual.length, 1);
    assert.equal(manual[0].assigned_user_id, admin.id);
    assert.ok(manual[0].source_key.includes("cs_open"));
    await db()`DELETE FROM task WHERE enrolment_id = ANY(${ids}::uuid[])`;
  }
});

it("drain: a failing expire call no longer fails the event; the tasks stay", async () => {
  await parkOthers();
  const { cls, ids } = await cancelledClass();
  await raiseEvent(
    "ClassCancelled",
    cls,
    { classId: cls, reason: "x", enrolmentIds: ids },
    null,
  );
  const r = await drainOutbox({
    handlers: makeHandlers({
      expireCheckoutSession: async () => {
        throw new Error("stripe down");
      },
    }),
  });
  assert.equal(r.failed, 0);
  assert.equal(r.processed, 1);
  assert.equal((await tasksOf(ids)).length, 6);
});
