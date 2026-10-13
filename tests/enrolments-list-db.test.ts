// Spec §9.11 list, §7 list conventions, §12.1 seats, §6 enrolment row: what
// the enrolments list returns, how each filter narrows it, and who may read it.
import { after } from "node:test";
import assert from "node:assert/strict";
import { listEnrolments } from "../lib/enrolments/list.ts";
import { PermissionError } from "../lib/auth/permissions.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrolmentListQuerySchema } from "../lib/validation/enrolment-query.ts";
import { enrol, it, newClass, newCourse, newPerson, newUser } from "./seed.ts";

after(closeDb);

// The screen always goes through the schema, so the tests do too.
const query = (input: Record<string, unknown> = {}) =>
  enrolmentListQuerySchema.parse(input);

it("reports the row the list shows", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 10 });
  const personId = await newPerson("Tan Mei Ling", "+60123456789");
  const id = await enrol(classId, "confirmed", {
    personId,
    pricePaid: "1800.00",
    payerType: "company",
  });

  const { data, page } = await listEnrolments(
    query({ classId: classId }),
    viewer,
  );
  assert.equal(page.total, 1);
  assert.equal(page.page, 1);
  assert.equal(page.limit, 25);
  const [row] = data;
  assert.equal(row.id, id);
  assert.equal(row.personId, personId);
  assert.equal(row.personName, "Tan Mei Ling");
  assert.equal(row.classId, classId);
  assert.ok(row.classCode);
  assert.equal(row.courseName, "Test course");
  assert.ok(row.classStartDate);
  assert.ok(row.classEndDate);
  assert.equal(row.status, "confirmed");
  assert.equal(row.holdsSeat, true);
  assert.equal(row.payerType, "company");
  assert.equal(row.pricePaidMyr, "1800.00");
  assert.ok(row.createdAt);
  // §9.10 omits them and so does this (§13, PDPA).
  assert.ok(!("phone" in row), "no phone on the list");
  assert.ok(!("email" in row), "no email on the list");
});

// §9.8's cut: a class that has started but not finished is still upcoming.
it("defaults to classes that have not finished", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  // Started two days ago, ends tomorrow: the §9.8 cut keeps it upcoming.
  const running = await newClass({ courseId, startOffsetDays: 1 });
  await db()`
    UPDATE class SET start_date = start_date - 3 WHERE id = ${running}`;
  const finished = await newClass({ courseId, startOffsetDays: -30 });
  const soon = await newClass({ courseId, startOffsetDays: 7 });
  for (const c of [running, finished, soon]) await enrol(c, "confirmed");

  const upcoming = await listEnrolments(query({ courseId }), viewer);
  assert.deepEqual(
    upcoming.data.map((r) => r.classId).sort(),
    [running, soon].sort(),
    "a class that started but has not ended is still upcoming",
  );

  const past = await listEnrolments(query({ courseId, when: "past" }), viewer);
  assert.deepEqual(
    past.data.map((r) => r.classId),
    [finished],
  );
});

// §12.1: an expired hold occupies nothing, but the row is still an enrolment.
it("marks an expired reservation as holding no seat", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "reserved", { reservedOffset: "-2 hours" });
  await enrol(classId, "reserved", { reservedOffset: "6 hours" });
  await enrol(classId, "cancelled");

  const { data } = await listEnrolments(query({ classId }), viewer);
  assert.equal(data.length, 3, "every status is listed");
  assert.equal(data.filter((r) => r.holdsSeat).length, 1);
});

it("narrows by class, course, status and payer, ANDed together", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const classId = await newClass({ courseId });
  const other = await newClass({ courseId });
  await enrol(classId, "payment_pending", { payerType: "company" });
  await enrol(classId, "confirmed", { payerType: "self" });
  await enrol(other, "payment_pending", { payerType: "self" });

  const byClass = await listEnrolments(query({ classId }), viewer);
  assert.equal(byClass.page.total, 2);

  const byCourse = await listEnrolments(query({ courseId }), viewer);
  assert.equal(byCourse.page.total, 3);

  const both = await listEnrolments(
    query({ classId, status: "payment_pending" }),
    viewer,
  );
  assert.equal(both.page.total, 1);
  assert.equal(both.data[0].payerType, "company");

  const byPayer = await listEnrolments(
    query({ courseId, payerType: "self" }),
    viewer,
  );
  assert.equal(byPayer.page.total, 2);
});

// §5, not the payment table: whether a price is stored on the enrolment.
it("filters on whether a price is recorded, reading no payment row", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "confirmed", { pricePaid: "1800.00" });
  const noPrice = await enrol(classId, "payment_pending");

  const without = await listEnrolments(
    query({ classId, hasPrice: "false" }),
    viewer,
  );
  assert.deepEqual(
    without.data.map((r) => r.id),
    [noPrice],
  );
  const withPrice = await listEnrolments(
    query({ classId, hasPrice: "true" }),
    viewer,
  );
  assert.equal(withPrice.page.total, 1);
  assert.equal(withPrice.data[0].pricePaidMyr, "1800.00");
});

it("takes an inclusive enrolled-between range", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const old = await enrol(classId, "confirmed");
  const mid = await enrol(classId, "confirmed");
  const recent = await enrol(classId, "confirmed");
  // Three Kuala Lumpur days: the 10th, the 11th and the 12th.
  await db()`UPDATE enrolment SET created_at = '2026-10-10T04:00:00Z' WHERE id = ${old}`;
  await db()`UPDATE enrolment SET created_at = '2026-10-11T04:00:00Z' WHERE id = ${mid}`;
  await db()`UPDATE enrolment SET created_at = '2026-10-12T04:00:00Z' WHERE id = ${recent}`;

  const { data } = await listEnrolments(
    query({
      classId,
      enrolledFrom: "2026-10-10",
      enrolledTo: "2026-10-11",
    }),
    viewer,
  );
  assert.deepEqual(data.map((r) => r.id).sort(), [old, mid].sort());
});

it("searches the person by name, email and phone (§9.1)", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const personId = await newPerson("Tan Mei Ling", "+60123456789");
  await db()`UPDATE person SET email = 'meiling@example.com', phone_e164 = '+60123456789' WHERE id = ${personId}`;
  const wanted = await enrol(classId, "confirmed", { personId });
  await enrol(classId, "confirmed", { name: "Chong Wei Ming" });

  for (const q of [
    "Tan Mei",
    "meiling@example.com",
    "012-345 6789",
    "+60123456789",
    "3456789",
  ]) {
    const { data } = await listEnrolments(query({ classId, q }), viewer);
    assert.deepEqual(
      data.map((r) => r.id),
      [wanted],
      q,
    );
  }

  // Combines with a filter rather than replacing it.
  const none = await listEnrolments(
    query({ classId, q: "Tan Mei", status: "cancelled" }),
    viewer,
  );
  assert.equal(none.page.total, 0);
});

it("does not match the booker", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "confirmed", {
    name: "Chong Wei Ming",
    bookerName: "Priya Nair",
  });

  const { data } = await listEnrolments(query({ classId, q: "Priya" }), viewer);
  assert.equal(data.length, 0);
});

it("sorts by person, by class and by enrolment date", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const first = await enrol(classId, "confirmed", { name: "zara lim" });
  const second = await enrol(classId, "confirmed", { name: "Ahmad Bakri" });
  // `now()` is the transaction's clock, so every row seeded here shares one
  // created_at. Spread them so "newest first" has something to order by.
  await db()`UPDATE enrolment SET created_at = now() - interval '1 day' WHERE id = ${first}`;

  const byPerson = await listEnrolments(
    query({ classId, sort: "person" }),
    viewer,
  );
  assert.deepEqual(
    byPerson.data.map((r) => r.personName),
    ["Ahmad Bakri", "zara lim"],
    "A–Z ignoring case",
  );

  const newestFirst = await listEnrolments(query({ classId }), viewer);
  assert.equal(newestFirst.data[0].id, second, "no sort means newest first");
  const oldestFirst = await listEnrolments(
    query({ classId, sort: "enrolled" }),
    viewer,
  );
  assert.equal(oldestFirst.data[0].id, first);
});

it("pages stably and counts the filtered set", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 30 });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await enrol(classId, "confirmed"));
  // Same instant for all five: only the id tie-break keeps paging stable.
  await db()`UPDATE enrolment SET created_at = now() WHERE class_id = ${classId}`;

  const seen: string[] = [];
  for (const page of [1, 2, 3]) {
    const res = await listEnrolments(
      query({ classId, limit: 2, page }),
      viewer,
    );
    assert.equal(res.page.total, 5, "total counts the filter, not the page");
    seen.push(...res.data.map((r) => r.id));
  }
  assert.equal(new Set(seen).size, 5, "no row shown twice or skipped");
});

// §6 enrolment row: five roles read, marketing and part_time have none.
it("refuses the roles with no enrolment access", async () => {
  const classId = await newClass();
  const creator = await newUser();
  await enrol(classId, "confirmed");

  for (const role of ["marketing", "part_time"] as const)
    await assert.rejects(
      listEnrolments(query({ classId }), await newUser(role)),
      PermissionError,
      role,
    );

  for (const role of [
    "super_admin",
    "management",
    "sales",
    "support",
    "operations",
  ] as const) {
    const res = await listEnrolments(query({ classId }), await newUser(role));
    assert.equal(res.page.total, 1, `${role} sees rows they did not create`);
  }
  assert.ok(creator.id);
});
