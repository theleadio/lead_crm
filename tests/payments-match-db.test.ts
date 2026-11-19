// Spec §11.3 payment match (`matchPayment`, lib/payments/match.ts), against
// the database: what one match writes, when it is refused, and that a refusal
// writes nothing. Each test runs in a transaction that is rolled back (`it` in
// ./seed.ts), except the two-at-once test, which commits and cleans up.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Role, Viewer } from "../lib/auth/permissions.ts";
import { matchPayment } from "../lib/payments/match.ts";
import { paymentMatchResponse } from "../lib/payments/write-response.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newPerson, newUser } from "./seed.ts";

after(closeDb);

// Exactly what lead_sales `recordUnmatched` writes: an unmatched Stripe
// payment with no seat or deal, and one match_payment task on it.
async function unmatched(
  opts: { amount?: string; status?: string; refunded?: string } = {},
): Promise<{ paymentId: string; taskId: string }> {
  const sql = db();
  const session = `cs_test_${crypto.randomUUID()}`;
  const [p] = await sql`
    INSERT INTO payment (match_status, method, status, amount_myr,
                         refunded_amount_myr, refunded_at,
                         stripe_payment_intent_id, stripe_checkout_session_id,
                         paid_at)
    VALUES ('unmatched', 'stripe_card', ${opts.status ?? "succeeded"},
            ${opts.amount ?? "1500.00"}, ${opts.refunded ?? "0"},
            ${opts.refunded ? new Date() : null},
            ${`pi_test_${crypto.randomUUID()}`}, ${session}, now())
    RETURNING id`;
  const [t] = await sql`
    INSERT INTO task (type, title, payment_id, due_at, notes, source_key)
    VALUES ('match_payment', 'Match a Stripe payment', ${p.id}, now(),
            'Why: the enrolment is cancelled. Payer: Test Payer <payer@lead.test>.',
            ${`stripe:${session}:match`})
    RETURNING id`;
  return { paymentId: p.id as string, taskId: t.id as string };
}

const paymentRow = async (id: string) =>
  (await db()`SELECT * FROM payment WHERE id = ${id}`)[0];
const taskRow = async (id: string) =>
  (await db()`SELECT * FROM task WHERE id = ${id}`)[0];
const seatsOf = async (personId: string, classId: string) =>
  await db()`
    SELECT * FROM enrolment WHERE person_id = ${personId} AND class_id = ${classId}`;
const eventsFor = async (paymentId: string, enrolmentId: string | null) =>
  (
    await db()`
      SELECT type, payload FROM event_outbox
      WHERE aggregate_id = ${paymentId} OR payload->>'enrolmentId' = ${enrolmentId ?? ""}
      ORDER BY created_at, type`
  ).map((e) => ({ type: e.type as string, payload: e.payload }));

// Nothing changed: the payment is still unmatched, the task still open, no
// seat added and no event raised.
async function untouched(
  paymentId: string,
  taskId: string,
  personId: string,
  classId: string,
  seatsBefore = 0,
) {
  const p = await paymentRow(paymentId);
  assert.equal(p.match_status, "unmatched");
  assert.equal(p.enrolment_id, null);
  assert.equal((await taskRow(taskId)).done_at, null);
  assert.equal((await seatsOf(personId, classId)).length, seatsBefore);
  assert.deepEqual(
    (await db()`SELECT 1 FROM event_outbox WHERE aggregate_id = ${paymentId}`)
      .length,
    0,
  );
}

it("a new seat: confirmed at the class price, payment linked, task closed, three events, audited", async () => {
  const viewer = await newUser("operations");
  const { paymentId, taskId } = await unmatched();
  const personId = await newPerson("Paid Student");
  const classId = await newClass({ priceMyr: "1200.00" });

  const r = await matchPayment(paymentId, { personId, classId }, viewer);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.match.seatCreated, true);
  assert.equal(r.match.status, "confirmed");

  const [seat] = await seatsOf(personId, classId);
  assert.equal(seat.id, r.match.enrolmentId);
  assert.equal(seat.status, "confirmed");
  assert.equal(
    String(seat.price_paid_myr),
    "1200.00",
    "class price, not the Stripe amount",
  );
  assert.equal(seat.created_by, viewer.id);

  const p = await paymentRow(paymentId);
  assert.equal(p.enrolment_id, seat.id);
  assert.equal(p.match_status, "matched");
  const t = await taskRow(taskId);
  assert.ok(t.done_at);
  assert.equal(t.done_by, viewer.id);
  assert.equal(t.is_cancelled, false);

  const [{ language }] = await db()`
    SELECT preferred_language AS language FROM person WHERE id = ${personId}`;
  const events = await eventsFor(paymentId, seat.id);
  assert.deepEqual(events.map((e) => e.type).sort(), [
    "EnrolmentConfirmed",
    "EnrolmentCreated",
    "PaymentRecorded",
  ]);
  const by = Object.fromEntries(events.map((e) => [e.type, e.payload]));
  assert.deepEqual(by.EnrolmentCreated, {
    enrolmentId: seat.id,
    personId,
    classId,
    status: "confirmed",
  });
  assert.deepEqual(by.PaymentRecorded, {
    paymentId,
    enrolmentId: seat.id,
    method: "stripe_card",
    amountMyr: "1500.00",
  });
  assert.deepEqual(by.EnrolmentConfirmed, {
    enrolmentId: seat.id,
    personId,
    classId,
    language,
  });

  for (const [entity, id] of [
    ["payment", paymentId],
    ["enrolment", seat.id],
    ["task", taskId],
  ])
    assert.equal(
      (
        await db()`SELECT 1 FROM audit_log WHERE entity = ${entity} AND entity_id = ${id} AND user_id = ${viewer.id}`
      ).length,
      1,
      `one audit row on the ${entity}`,
    );
  const [taskAudit] = await db()`
    SELECT after FROM audit_log WHERE entity = 'task' AND entity_id = ${taskId}`;
  assert.doesNotMatch(
    JSON.stringify(taskAudit.after),
    /payer@lead\.test/,
    "no free text",
  );
});

it("a person waiting on a payment_pending seat: that seat is confirmed, no second seat, no EnrolmentCreated", async () => {
  const viewer = await newUser("operations");
  const { paymentId } = await unmatched();
  const classId = await newClass();
  const seatId = await enrol(classId, "payment_pending");
  const [{ person_id: personId }] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${seatId}`;

  const r = await matchPayment(paymentId, { personId, classId }, viewer);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.match.enrolmentId, seatId);
  assert.equal(r.match.seatCreated, false);
  const seats = await seatsOf(personId, classId);
  assert.equal(seats.length, 1);
  assert.equal(seats[0].status, "confirmed");
  assert.deepEqual(
    (await eventsFor(paymentId, seatId)).map((e) => e.type).sort(),
    ["EnrolmentConfirmed", "PaymentRecorded"],
  );
});

it("a person already confirmed: the payment is linked, the status is left alone, no EnrolmentConfirmed", async () => {
  const viewer = await newUser("super_admin");
  const { paymentId } = await unmatched();
  const classId = await newClass();
  const seatId = await enrol(classId, "onboarded");
  const [{ person_id: personId, version }] = await db()`
    SELECT person_id, version FROM enrolment WHERE id = ${seatId}`;

  const r = await matchPayment(paymentId, { personId, classId }, viewer);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.match.status, "onboarded");
  const [seat] = await seatsOf(personId, classId);
  assert.equal(seat.status, "onboarded");
  assert.ok(
    Number(seat.version) > Number(version),
    "an open screen learns it is behind",
  );
  assert.equal((await paymentRow(paymentId)).enrolment_id, seatId);
  assert.deepEqual(
    (await eventsFor(paymentId, seatId)).map((e) => e.type),
    ["PaymentRecorded"],
  );
});

it("a waitlisted seat can't become confirmed: refused, naming the status, nothing written", async () => {
  const viewer = await newUser("operations");
  const { paymentId, taskId } = await unmatched();
  const classId = await newClass();
  const seatId = await enrol(classId, "waitlisted");
  const [{ person_id: personId }] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${seatId}`;

  const r = await matchPayment(paymentId, { personId, classId }, viewer);
  assert.deepEqual(r, { kind: "blocked_status", status: "waitlisted" });
  await untouched(paymentId, taskId, personId, classId, 1);
});

it("a full class refuses a new seat; a completed class doesn't; a cancelled class is refused", async () => {
  const viewer = await newUser("operations");
  const personId = await newPerson("Late Payer");

  const full = await newClass({ capacity: 1 });
  await enrol(full, "confirmed");
  const a = await unmatched();
  const r1 = await matchPayment(
    a.paymentId,
    { personId, classId: full },
    viewer,
  );
  assert.equal(r1.kind, "no_seats");
  if (r1.kind === "no_seats") assert.ok(r1.classCode.length > 0);
  await untouched(a.paymentId, a.taskId, personId, full);

  const past = await newClass({ capacity: 1, startOffsetDays: -30 });
  await enrol(past, "completed");
  await db()`UPDATE class SET status = 'completed' WHERE id = ${past}`;
  const b = await unmatched();
  const r2 = await matchPayment(
    b.paymentId,
    { personId, classId: past },
    viewer,
  );
  assert.equal(
    r2.kind,
    "ok",
    "a late payment for a past class can still be matched",
  );

  const gone = await newClass();
  await db()`UPDATE class SET status = 'cancelled' WHERE id = ${gone}`;
  const c = await unmatched();
  const r3 = await matchPayment(
    c.paymentId,
    { personId, classId: gone },
    viewer,
  );
  assert.equal(r3.kind, "class_cancelled");
  await untouched(c.paymentId, c.taskId, personId, gone);
});

it("an expired reservation in a class someone else filled: no_seats from the database, nothing written", async () => {
  const viewer = await newUser("operations");
  const classId = await newClass({ capacity: 1 });
  const expired = await enrol(classId, "reserved", {
    reservedOffset: "-1 hours",
  });
  await enrol(classId, "confirmed");
  const [{ person_id: personId }] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${expired}`;
  const { paymentId, taskId } = await unmatched();

  const r = await matchPayment(paymentId, { personId, classId }, viewer);
  assert.equal(r.kind, "no_seats");
  await untouched(paymentId, taskId, personId, classId, 1);
  assert.equal((await seatsOf(personId, classId))[0].status, "reserved");
});

it("matching twice is already_matched; a manual payment is not_unmatched; a full refund is refunded; a part refund still matches", async () => {
  const viewer = await newUser("operations");
  const personId = await newPerson("Twice");
  const classId = await newClass();
  const { paymentId } = await unmatched();
  assert.equal(
    (await matchPayment(paymentId, { personId, classId }, viewer)).kind,
    "ok",
  );
  assert.equal(
    (await matchPayment(paymentId, { personId, classId }, viewer)).kind,
    "already_matched",
  );

  const seatId = await enrol(await newClass(), "confirmed");
  const [manual] = await db()`
    INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no,
                         proof_file_key, paid_at)
    VALUES (${seatId}, 'bank_transfer', 'succeeded', 100, 'REF-M', ${`${seatId}/proof`}, now())
    RETURNING id`;
  assert.equal(
    (await matchPayment(manual.id, { personId, classId }, viewer)).kind,
    "not_unmatched",
  );

  const other = await newClass();
  const full = await unmatched({ status: "refunded", refunded: "1500.00" });
  assert.equal(
    (await matchPayment(full.paymentId, { personId, classId: other }, viewer))
      .kind,
    "refunded",
  );
  await untouched(full.paymentId, full.taskId, personId, other);

  const part = await unmatched({
    status: "partially_refunded",
    refunded: "500.00",
  });
  assert.equal(
    (await matchPayment(part.paymentId, { personId, classId: other }, viewer))
      .kind,
    "ok",
  );
});

it("a missing payment, a deleted or merged person, or a missing class is not_found, nothing written", async () => {
  const viewer = await newUser("operations");
  const classId = await newClass();
  const personId = await newPerson("Real");
  const { paymentId, taskId } = await unmatched();

  assert.equal(
    (await matchPayment(crypto.randomUUID(), { personId, classId }, viewer))
      .kind,
    "not_found",
  );
  assert.equal(
    (await matchPayment("not-a-uuid", { personId, classId }, viewer)).kind,
    "not_found",
  );

  const deleted = await newPerson("Deleted");
  await db()`UPDATE person SET deleted_at = now() WHERE id = ${deleted}`;
  assert.equal(
    (await matchPayment(paymentId, { personId: deleted, classId }, viewer))
      .kind,
    "not_found",
  );
  const merged = await newPerson("Merged");
  await db()`UPDATE person SET merged_into_id = ${personId} WHERE id = ${merged}`;
  assert.equal(
    (await matchPayment(paymentId, { personId: merged, classId }, viewer)).kind,
    "not_found",
  );
  assert.equal(
    (
      await matchPayment(
        paymentId,
        { personId, classId: crypto.randomUUID() },
        viewer,
      )
    ).kind,
    "not_found",
  );
  await untouched(paymentId, taskId, personId, classId);
});

it("only super_admin and operations match; every other role is forbidden and nothing is written", async () => {
  const classId = await newClass();
  const personId = await newPerson("Role Check");
  const { paymentId, taskId } = await unmatched();
  for (const role of [
    "sales",
    "support",
    "marketing",
    "part_time",
    "management",
  ] as Role[]) {
    const viewer: Viewer = await newUser(role);
    assert.equal(
      (await matchPayment(paymentId, { personId, classId }, viewer)).kind,
      "forbidden",
      role,
    );
  }
  await untouched(paymentId, taskId, personId, classId);
  assert.equal(
    (
      await matchPayment(
        paymentId,
        { personId, classId },
        await newUser("super_admin"),
      )
    ).kind,
    "ok",
  );
});

it("a refused role gets 403 and the denial is audit-logged", async () => {
  const viewer = await newUser("sales");
  const res = await paymentMatchResponse(
    { kind: "forbidden" },
    viewer,
    new Request("http://test/api/payments/x/match", { method: "POST" }),
  );
  assert.equal(res.status, 403);
  const [row] = await db()`
    SELECT entity, after FROM audit_log
    WHERE user_id = ${viewer.id} AND action = 'permission_denied'`;
  assert.equal(row.entity, "payment");
  assert.equal(row.after.route, "/api/payments/x/match");
});

// Two real transactions that can see each other, so this one commits and
// cleans up after itself through the replica role, as
// tests/public-register-db.test.ts does.
test(
  "two matches at once: exactly one wins, the other is already_matched",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    const sql = db();
    const viewer = await newUser("operations");
    const personId = await newPerson("Race");
    const classId = await newClass();
    const { paymentId, taskId } = await unmatched();
    try {
      const results = await Promise.all([
        matchPayment(paymentId, { personId, classId }, viewer),
        matchPayment(paymentId, { personId, classId }, viewer),
      ]);
      assert.deepEqual(results.map((r) => r.kind).sort(), [
        "already_matched",
        "ok",
      ]);
      assert.equal((await seatsOf(personId, classId)).length, 1);
    } finally {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        const seats = await tx`
          SELECT id FROM enrolment WHERE class_id = ${classId}`;
        const ids = [
          paymentId,
          taskId,
          personId,
          classId,
          ...seats.map((s) => s.id as string),
        ];
        await tx`DELETE FROM event_outbox WHERE aggregate_id = ANY(${ids}::uuid[])`;
        await tx`DELETE FROM audit_log WHERE entity_id = ANY(${ids}::uuid[]) OR user_id = ${viewer.id}`;
        await tx`DELETE FROM task WHERE id = ${taskId}`;
        await tx`DELETE FROM payment WHERE id = ${paymentId}`;
        await tx`DELETE FROM enrolment_status_history WHERE enrolment_id IN (
          SELECT id FROM enrolment WHERE class_id = ${classId})`;
        await tx`DELETE FROM enrolment WHERE class_id = ${classId}`;
        await tx`DELETE FROM person WHERE id = ${personId}`;
        const [cls] =
          await tx`SELECT course_id FROM class WHERE id = ${classId}`;
        await tx`DELETE FROM class WHERE id = ${classId}`;
        if (cls) await tx`DELETE FROM course WHERE id = ${cls.course_id}`;
        await tx`DELETE FROM app_user WHERE id = ${viewer.id}`;
      });
    }
  },
);
