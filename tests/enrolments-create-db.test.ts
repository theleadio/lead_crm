// Spec §9.11 manual create (the §9.10 Roster's Add), §8.3 price, §12.1 seats
// and holds, §5 double-booking, §11.1 EnrolmentCreated.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createEnrolment } from "../lib/enrolments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrolmentCreateSchema } from "../lib/validation/enrolment.ts";
import { enrol, it, newClass, newPerson, newUser } from "./seed.ts";

after(closeDb);

const row = async (id: string) => {
  const [r] = await db()`SELECT * FROM enrolment WHERE id = ${id}`;
  return r;
};

it("enrols a person, taking the price from the class (§8.3)", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 10, priceMyr: "1800.00" });
  const personId = await newPerson("Tan Mei Ling");

  const result = await createEnrolment(
    {
      personId,
      classId,
      status: "payment_pending",
      payerType: "company",
    },
    viewer,
  );
  assert.equal(result.kind, "created");
  const id = result.kind === "created" ? result.id : "";
  const created = await row(id);
  assert.equal(created.status, "payment_pending");
  assert.equal(created.payer_type, "company");
  assert.equal(String(created.price_paid_myr), "1800.00");
  assert.equal(created.created_by, viewer.id);

  const raised = await db()`
    SELECT type, payload FROM event_outbox
    WHERE aggregate_id = ${id} AND type = 'EnrolmentCreated'`;
  assert.equal(raised.length, 1);
  assert.equal(raised[0].payload.personId, personId);
  assert.equal(raised[0].payload.status, "payment_pending");

  const [audit] = await db()`
    SELECT action, after FROM audit_log
    WHERE entity = 'enrolment' AND entity_id = ${id}`;
  assert.equal(audit.action, "create");
  assert.equal(audit.after.class_id, classId);
});

// §12.1 / migration 007: the database fills the hold, the app sends none.
it("lets the database fill a reservation's hold", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling");

  const result = await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "created");
  const created = await row(result.kind === "created" ? result.id : "");
  assert.ok(created.seat_reserved_until, "007 filled the hold");
  assert.ok(
    new Date(created.seat_reserved_until as string) > new Date(),
    "the hold is in the future",
  );
});

it("ignores a price the caller tried to send", async () => {
  const viewer = await newUser();
  const classId = await newClass({ priceMyr: "1800.00" });
  const personId = await newPerson("Tan Mei Ling");

  // Through the schema, as the route does: §8.3 means an amount in the body
  // never reaches the service at all.
  const body = enrolmentCreateSchema.parse({
    personId,
    classId,
    status: "reserved",
    payerType: "self",
    pricePaidMyr: "1.00",
  });
  const result = await createEnrolment(body, viewer);
  const created = await row(result.kind === "created" ? result.id : "");
  assert.equal(String(created.price_paid_myr), "1800.00");
});

it("refuses a full class, creating nothing", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  await enrol(classId, "confirmed");
  const personId = await newPerson("Tan Mei Ling");

  const result = await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "no_seats");
  const [{ count }] = await db()`
    SELECT count(*)::int FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(count, 1);
});

// §5 `enrolment_person_class_active_uq`.
it("refuses a second live enrolment, naming the first", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling");
  const existing = await enrol(classId, "confirmed", { personId });

  const result = await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "duplicate");
  assert.equal(result.kind === "duplicate" && result.enrolmentId, existing);
});

// A cancelled row holds nothing, so re-booking is allowed (§5 predicate).
it("lets a cancelled person book the same class again", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling");
  await enrol(classId, "cancelled", { personId });

  const result = await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "created");
});

it("is not_found for an unknown class or person", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling");
  assert.equal(
    (
      await createEnrolment(
        {
          personId,
          classId: crypto.randomUUID(),
          status: "reserved",
          payerType: "self",
        },
        viewer,
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (
      await createEnrolment(
        {
          personId: crypto.randomUUID(),
          classId,
          status: "reserved",
          payerType: "self",
        },
        viewer,
      )
    ).kind,
    "not_found",
  );
});

// §6 enrolment row: only super_admin and operations.
it("refuses the roles that may not add an enrolment", async () => {
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling");
  for (const role of ["management", "sales", "support", "part_time"] as const)
    assert.equal(
      (
        await createEnrolment(
          { personId, classId, status: "reserved", payerType: "self" },
          await newUser(role),
        )
      ).kind,
      "forbidden",
      role,
    );
  const [{ count }] = await db()`
    SELECT count(*)::int FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(count, 0);
});
