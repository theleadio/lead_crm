// Spec §9.11 transfer, §12.4, §12.1 seats, §12.7 money, §11.1 events: moving a
// confirmed student to another class, and every way that is refused.
import { after } from "node:test";
import assert from "node:assert/strict";
import { transferEnrolment } from "../lib/enrolments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import {
  enrol,
  it,
  newClass,
  newCourse,
  newPerson,
  newUser,
  pay,
} from "./seed.ts";

after(closeDb);

const row = async (id: string) => {
  const [r] = await db()`SELECT * FROM enrolment WHERE id = ${id}`;
  return r;
};

it("moves a confirmed student, linking both rows (§11.1)", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId, priceMyr: "1800.00" });
  const to = await newClass({ courseId, priceMyr: "2500.00" });
  const id = await enrol(from, "confirmed", {
    pricePaid: "1800.00",
    payerType: "company",
    bookerName: "HR Officer",
  });

  const result = await transferEnrolment(id, { toClassId: to }, 1, viewer);
  assert.equal(result.kind, "transferred");
  assert.ok(result.kind === "transferred" && result.newEnrolmentId);
  const newId = result.kind === "transferred" ? result.newEnrolmentId : "";

  const source = await row(id);
  assert.equal(source.status, "transferred");
  assert.equal(source.transferred_to_enrolment_id, newId);

  const created = await row(newId);
  assert.equal(created.status, "confirmed");
  assert.equal(created.class_id, to);
  assert.equal(created.person_id, source.person_id);
  assert.equal(created.payer_type, "company");
  assert.equal(created.booker_person_id, source.booker_person_id);
  // §12.7: the snapshot moves, not the target class's price.
  assert.equal(String(created.price_paid_myr), "1800.00");

  const raised = await db()`
    SELECT type, payload FROM event_outbox
    WHERE aggregate_id = ${id} AND type = 'EnrolmentTransferred'`;
  assert.equal(raised.length, 1);
  assert.equal(raised[0].payload.fromClassId, from);
  assert.equal(raised[0].payload.toClassId, to);

  const [audit] = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'enrolment' AND entity_id = ${id}`;
  assert.equal(audit.before.class_id, from);
  assert.equal(audit.after.class_id, to);
});

// Proposal open question 1: the payment stays on the row it was recorded on.
it("leaves the payment on the row it was recorded against", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId });
  const id = await enrol(from, "confirmed", { pricePaid: "1800.00" });
  const paymentId = await pay(id);

  await transferEnrolment(id, { toClassId: to }, 1, viewer);
  const [payment] = await db()`
    SELECT enrolment_id FROM payment WHERE id = ${paymentId}`;
  assert.equal(payment.enrolment_id, id);
});

it("refuses a target class with no seats left, writing nothing", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId, capacity: 1 });
  await enrol(to, "confirmed");
  const id = await enrol(from, "confirmed");

  const result = await transferEnrolment(id, { toClassId: to }, 1, viewer);
  assert.equal(result.kind, "no_seats");
  assert.equal((await row(id)).status, "confirmed");
  const [{ count }] = await db()`
    SELECT count(*)::int FROM enrolment WHERE class_id = ${to}`;
  assert.equal(count, 1, "no enrolment was created on the full class");
});

// §5 `enrolment_person_class_active_uq`.
it("refuses a class the person is already in, naming that enrolment", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId });
  const personId = await newPerson("Tan Mei Ling");
  const id = await enrol(from, "confirmed", { personId });
  const existing = await enrol(to, "reserved", { personId });

  const result = await transferEnrolment(id, { toClassId: to }, 1, viewer);
  assert.equal(result.kind, "duplicate");
  assert.equal(result.kind === "duplicate" && result.enrolmentId, existing);
  assert.equal((await row(id)).status, "confirmed");
});

// §12.4: confirmed is the only status with an arrow to transferred.
it("refuses every status but confirmed", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId });
  for (const status of ["reserved", "payment_pending", "onboarded"] as const) {
    const id = await enrol(from, status);
    const result = await transferEnrolment(id, { toClassId: to }, 1, viewer);
    assert.equal(result.kind, "not_transferable", status);
    assert.equal((await row(id)).status, status);
  }
});

it("refuses the class the enrolment is already in", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const id = await enrol(classId, "confirmed");
  const result = await transferEnrolment(id, { toClassId: classId }, 1, viewer);
  assert.equal(result.kind, "same_class");
});

it("is stale when the version is behind, and not_found for an unknown class", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId });
  const id = await enrol(from, "confirmed");

  assert.equal(
    (await transferEnrolment(id, { toClassId: to }, 99, viewer)).kind,
    "stale",
  );
  assert.equal(
    (await transferEnrolment(id, { toClassId: crypto.randomUUID() }, 1, viewer))
      .kind,
    "not_found",
  );
  assert.equal((await row(id)).status, "confirmed");
});

// §6 enrolment row: five roles read, two write.
it("refuses the roles that may not write an enrolment", async () => {
  const courseId = await newCourse();
  const from = await newClass({ courseId });
  const to = await newClass({ courseId });
  const id = await enrol(from, "confirmed");
  for (const role of ["management", "sales", "support", "part_time"] as const)
    assert.equal(
      (await transferEnrolment(id, { toClassId: to }, 1, await newUser(role)))
        .kind,
      "forbidden",
      role,
    );
  assert.equal((await row(id)).status, "confirmed");
});
