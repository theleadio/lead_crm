// Spec §9.11 Enrolment detail read, §12.1 seats, §12.7 money, §6 enrolment and
// payment rows: what the screen is given, and who is given it.
import { after } from "node:test";
import assert from "node:assert/strict";
import { getEnrolment } from "../lib/enrolments/service.ts";
import { PermissionError } from "../lib/auth/permissions.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newPerson, newUser, pay } from "./seed.ts";

after(closeDb);

it("reports the enrolment, its person and its class", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 20, priceMyr: "1800.00" });
  const id = await enrol(classId, "confirmed", {
    name: "Tan Mei Ling",
    bookerName: "HR Officer",
    pricePaid: "1800.00",
    payerType: "company",
  });

  const e = await getEnrolment(id, viewer);
  assert.ok(e);
  assert.equal(e.status, "confirmed");
  assert.equal(e.personName, "Tan Mei Ling");
  assert.equal(e.bookerName, "HR Officer");
  assert.equal(e.payerType, "company");
  assert.equal(e.pricePaidMyr, "1800.00");
  assert.equal(e.classId, classId);
  assert.ok(e.classCode);
  assert.ok(e.courseName);
  assert.equal(e.version, 1);
  assert.equal(e.onboardingStep, 0);
  assert.equal(e.certificateNo, null);
  assert.equal(e.transferredToEnrolmentId, null);
});

// §12.7: the price on the enrolment is a snapshot, never the class's price.
it("keeps the stored price after the class price changes", async () => {
  const viewer = await newUser();
  const classId = await newClass({ priceMyr: "1800.00" });
  const id = await enrol(classId, "confirmed", { pricePaid: "1800.00" });

  await db()`UPDATE class SET price_myr = '2500.00' WHERE id = ${classId}`;
  const e = await getEnrolment(id, viewer);
  assert.equal(e?.pricePaidMyr, "1800.00");
});

// §12.1: the database's two counts, and an expired reservation holding nothing.
it("reports the §12.1 seat numbers of its class", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 20 });
  const id = await enrol(classId, "confirmed");
  await enrol(classId, "confirmed");
  await enrol(classId, "reserved", { reservedOffset: "2 hours" });
  await enrol(classId, "reserved", { reservedOffset: "-2 hours" });
  await enrol(classId, "cancelled");

  const e = await getEnrolment(id, viewer);
  assert.equal(e?.confirmedCount, 2);
  assert.equal(e?.reservedCount, 1, "an expired hold takes no seat");
  assert.equal(e?.seatsAvailable, 17);
  assert.equal(e?.capacity, 20);
});

it("shows a reservation's deadline and a cancellation's reason", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const reserved = await enrol(classId, "reserved", {
    reservedOffset: "6 hours",
  });
  assert.ok((await getEnrolment(reserved, viewer))?.seatReservedUntil);

  const cancelled = await enrol(classId, "cancelled");
  await db()`
    UPDATE enrolment SET cancelled_reason = 'reservation_expired'
    WHERE id = ${cancelled}`;
  const e = await getEnrolment(cancelled, viewer);
  assert.equal(e?.cancelledReason, "reservation_expired");
  assert.equal(e?.seatReservedUntil, null);
});

it("names the class a transferred enrolment went to", async () => {
  const viewer = await newUser();
  const from = await newClass();
  const to = await newClass();
  const personId = await newPerson("Tan Mei Ling");
  const source = await enrol(from, "confirmed", { personId });
  const target = await enrol(to, "confirmed", { personId });
  const [{ code }] = await db()`SELECT code FROM class WHERE id = ${to}`;
  await db()`
    UPDATE enrolment
    SET status = 'transferred', transferred_to_enrolment_id = ${target}
    WHERE id = ${source}`;

  const e = await getEnrolment(source, viewer);
  assert.equal(e?.status, "transferred");
  assert.equal(e?.transferredToEnrolmentId, target);
  assert.equal(e?.transferredToClassCode, code);
});

it("is null for an unknown or malformed id", async () => {
  const viewer = await newUser();
  assert.equal(await getEnrolment("not-an-id", viewer), null);
  assert.equal(await getEnrolment(crypto.randomUUID(), viewer), null);
});

// §6 enrolment row: marketing and part_time have no access at all.
it("refuses the roles with no enrolment access", async () => {
  const classId = await newClass();
  const id = await enrol(classId, "confirmed");
  for (const role of ["marketing", "part_time"] as const)
    await assert.rejects(
      getEnrolment(id, await newUser(role)),
      PermissionError,
      role,
    );
  for (const role of ["management", "sales", "support", "operations"] as const)
    assert.ok(await getEnrolment(id, await newUser(role)), role);
});

// §6 payment row: super_admin F, management R, sales R on their own deals,
// support none, operations E, marketing and part_time none (they have no
// enrolment either). Every payment read is audit-logged.
it("shows payments to the roles that may read them, and logs each read", async () => {
  const classId = await newClass();
  const id = await enrol(classId, "confirmed", { pricePaid: "1800.00" });
  const paymentId = await pay(id);

  const ops = await newUser("operations");
  const e = await getEnrolment(id, ops);
  assert.equal(e?.payments?.length, 1);
  assert.equal(e?.payments?.[0].id, paymentId);
  assert.equal(e?.payments?.[0].amountMyr, "1800.00");
  const [{ count }] = await db()`
    SELECT count(*)::int FROM audit_log
    WHERE action = 'view' AND entity = 'payment' AND entity_id = ${paymentId}
      AND user_id = ${ops.id}`;
  assert.equal(count, 1, "one view audit row per payment read");

  // Support reads the enrolment but never the money (§6).
  const support = await getEnrolment(id, await newUser("support"));
  assert.equal(support?.payments, null);
  assert.equal(support?.status, "confirmed");
});

it("keeps another owner's money away from sales (§6 ²)", async () => {
  const classId = await newClass();
  const sales = await newUser("sales");
  const other = await newUser("sales");
  const personId = await newPerson("Tan Mei Ling");
  const id = await enrol(classId, "confirmed", { personId });
  await pay(id);

  // The enrolment's deal belongs to someone else.
  const [deal] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, owner_user_id)
    VALUES ('individual', 'new', ${personId}, ${other.id})
    RETURNING id`;
  await db()`UPDATE enrolment SET deal_id = ${deal.id} WHERE id = ${id}`;

  assert.deepEqual((await getEnrolment(id, sales))?.payments, []);
  assert.equal((await getEnrolment(id, other))?.payments?.length, 1);
});
