// Spec §9.11 manual create (the §9.10 Roster's Add), §8.3 price, §12.1 seats
// and holds, §5 double-booking, §11.1 EnrolmentCreated.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createEnrolment } from "../lib/enrolments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrolmentCreateSchema } from "../lib/validation/enrolment.ts";
import { enrol, it, newClass, newCourse, newPerson, newUser } from "./seed.ts";

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

// §9.6 "Create enrolment": the deal screen is the only place an enrolment
// learns which deal it closes. The §9.10 roster leaves `deal_id` null (§5).
async function newDeal(personId: string, courseId: string | null) {
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, course_id)
    VALUES ('individual', 'engaged', ${personId}, ${courseId})
    RETURNING id`;
  return d.id as string;
}

it("an enrolment created from a deal carries it (§9.6)", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const classId = await newClass({ courseId, capacity: 5 });
  const personId = await newPerson("Deal Person");
  const dealId = await newDeal(personId, courseId);

  const result = await createEnrolment(
    { personId, classId, dealId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "created");
  const created = await row(result.kind === "created" ? result.id : "");
  assert.equal(created.deal_id, dealId);
});

it("the roster's own create still leaves the deal empty", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 5 });
  const personId = await newPerson("Walk In");

  const result = await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "created");
  const created = await row(result.kind === "created" ? result.id : "");
  assert.equal(created.deal_id, null);
});

it("a class running another course is refused, not mis-linked", async () => {
  const viewer = await newUser();
  const personId = await newPerson("Wrong Course");
  const dealId = await newDeal(personId, await newCourse());
  // A class on a different course entirely — booking it against this deal
  // would put the money on the wrong course.
  const classId = await newClass({ capacity: 5 });

  const result = await createEnrolment(
    { personId, classId, dealId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "deal_course_mismatch");
  const [any] = await db()`
    SELECT count(*)::int AS n FROM enrolment WHERE person_id = ${personId}`;
  assert.equal(any.n, 0);
});

it("a deal with no course takes any class", async () => {
  const viewer = await newUser();
  const personId = await newPerson("No Course Deal");
  const dealId = await newDeal(personId, null);
  const classId = await newClass({ capacity: 5 });

  const result = await createEnrolment(
    { personId, classId, dealId, status: "reserved", payerType: "self" },
    viewer,
  );
  assert.equal(result.kind, "created");
});

it("a deal belonging to someone else is refused", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const classId = await newClass({ courseId, capacity: 5 });
  const theirDeal = await newDeal(await newPerson("Deal Owner"), courseId);
  const personId = await newPerson("Someone Else");

  const result = await createEnrolment(
    {
      personId,
      classId,
      dealId: theirDeal,
      status: "reserved",
      payerType: "self",
    },
    viewer,
  );
  assert.equal(result.kind, "not_found");
});

it("enrolmentCreateSchema takes an optional dealId and checks its shape", async () => {
  const base = {
    personId: crypto.randomUUID(),
    classId: crypto.randomUUID(),
    status: "reserved",
    payerType: "self",
  };
  assert.equal(enrolmentCreateSchema.safeParse(base).success, true);
  assert.equal(
    enrolmentCreateSchema.safeParse({ ...base, dealId: crypto.randomUUID() })
      .success,
    true,
  );
  assert.equal(
    enrolmentCreateSchema.safeParse({ ...base, dealId: "not-a-uuid" }).success,
    false,
  );
});

it("the deal's class follows the enrolment created from it (§9.6)", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const classId = await newClass({ courseId, capacity: 5 });
  const personId = await newPerson("Class Follows");
  const dealId = await newDeal(personId, courseId);

  await createEnrolment(
    { personId, classId, dealId, status: "reserved", payerType: "self" },
    viewer,
  );
  const [deal] = await db()`SELECT class_id FROM deal WHERE id = ${dealId}`;
  assert.equal(deal.class_id, classId);

  const [audit] = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'deal' AND entity_id = ${dealId} ORDER BY at DESC LIMIT 1`;
  assert.equal(audit.before.classId, null);
  assert.equal(audit.after.classId, classId);
});

it("a roster enrolment moves nobody's deal", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const classId = await newClass({ courseId, capacity: 5 });
  const personId = await newPerson("No Deal Sent");
  // The person has a deal, but the roster's create does not name it, so the
  // deal is left alone — an enrolment with no deal says nothing about one.
  const dealId = await newDeal(personId, courseId);

  await createEnrolment(
    { personId, classId, status: "reserved", payerType: "self" },
    viewer,
  );
  const [deal] = await db()`SELECT class_id FROM deal WHERE id = ${dealId}`;
  assert.equal(deal.class_id, null);
});
