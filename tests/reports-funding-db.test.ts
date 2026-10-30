// Integration tests for the two §9.18 panels that read existing tables.
// Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import { fundingSplit, priceAgainstHrdcShare } from "../lib/reports/funding.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// Enrolments are ranged on created_at, which defaults to now(), so the range
// is today either side. The fixture is the only thing a rolled-back
// transaction can see of its own making — but the seeded database has
// enrolments too, so every assertion looks up its own course by name.
const RANGE = adsReportQuerySchema.parse({});

async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Report reader', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newCourse(fields: {
  price: string | null;
  durationDays?: number;
}): Promise<{ id: string; name: string }> {
  const name = `Report course ${crypto.randomUUID().slice(0, 8)}`;
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES (${crypto.randomUUID().slice(0, 12)}, ${name}, 'workshop',
            ${fields.durationDays ?? 1}, ${fields.price})
    RETURNING id`;
  return { id: c.id, name };
}

async function newClass(
  courseId: string,
  language: "en" | "zh" = "en",
): Promise<string> {
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, price_myr, status)
    VALUES (${courseId}, ${crypto.randomUUID().slice(0, 12)},
            current_date + 30, current_date + 30, ${language}, 'online',
            'https://lead.test/class', 50, 1000, 'open')
    RETURNING id`;
  return c.id;
}

async function newEnrolment(fields: {
  classId: string;
  funding?: "self" | "company" | "hrdc" | "other" | null;
  status?: string;
}): Promise<void> {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Report student') RETURNING id`;
  let dealId: string | null = null;
  if (fields.funding) {
    const [d] = await db()`
      INSERT INTO deal (pipeline, stage, person_id, funding_type)
      VALUES ('individual', 'new', ${p.id}, ${fields.funding})
      RETURNING id`;
    dealId = d.id;
  }
  const status = fields.status ?? "confirmed";
  await db()`
    INSERT INTO enrolment (person_id, class_id, deal_id, status)
    VALUES (${p.id}, ${fields.classId}, ${dealId}, ${status})`;
}

// §6: the service is the boundary, not the screen.
it("part_time cannot read either funding panel", async () => {
  const partTime = await newUser("part_time");
  await assert.rejects(() => fundingSplit(partTime, RANGE), PermissionError);
  await assert.rejects(
    () => priceAgainstHrdcShare(partTime, RANGE),
    PermissionError,
  );
});

// §12.6: a grant seat is HRDC, and it is not an unpaid seat.
it("a grant-funded seat counts as HRDC, a self-funded one against it", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "3500.00", durationDays: 2 });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "hrdc" });
  await newEnrolment({ classId: cls, funding: "hrdc" });
  await newEnrolment({ classId: cls, funding: "self" });

  const row = (await fundingSplit(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.deepEqual(
    { hrdc: row?.hrdc, notHrdc: row?.notHrdc, days: row?.durationDays },
    { hrdc: 2, notHrdc: 1, days: 2 },
  );
});

// An enrolment with no deal has no recorded funding. It is counted as not
// HRDC rather than guessed into the HRDC side, and the panel says so.
it("a seat with no deal counts as not HRDC, not as HRDC", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "1200.00" });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: null });

  const row = (await fundingSplit(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.deepEqual(
    { hrdc: row?.hrdc, notHrdc: row?.notHrdc },
    {
      hrdc: 0,
      notHrdc: 1,
    },
  );
});

// §12.1: only a seat-holding status is a seat. A cancelled enrolment is in
// neither column, so this screen cannot report a seat §9.8 would refuse.
it("a cancelled seat is counted in neither column", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "900.00" });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "hrdc", status: "cancelled" });
  await newEnrolment({ classId: cls, funding: "self", status: "refunded" });
  await newEnrolment({ classId: cls, funding: "self", status: "waitlisted" });

  const row = (await fundingSplit(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.equal(row, undefined, "no seat-holding enrolment, so no row");
});

it("an expired reservation holds no seat", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "900.00" });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "self", status: "reserved" });
  // seat_reserved_until in the past: the §12.1 rule frees the seat.
  await db()`
    UPDATE enrolment SET seat_reserved_until = now() - interval '1 hour'
    WHERE class_id = ${cls}`;

  const row = (await fundingSplit(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.equal(row, undefined);
});

it("the two class languages are separate rows for one course", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "2000.00" });
  const en = await newClass(course.id, "en");
  const zh = await newClass(course.id, "zh");
  await newEnrolment({ classId: en, funding: "hrdc" });
  await newEnrolment({ classId: zh, funding: "self" });

  const rows = (await fundingSplit(viewer, RANGE)).filter(
    (r) => r.course === course.name,
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.language).sort(), ["en", "zh"]);
});

it("price against HRDC share: the price, the share and the seat count", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "4000.00" });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "hrdc" });
  await newEnrolment({ classId: cls, funding: "hrdc" });
  await newEnrolment({ classId: cls, funding: "hrdc" });
  await newEnrolment({ classId: cls, funding: "self" });

  const row = (await priceAgainstHrdcShare(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.equal(row?.listPriceMyr, "4000.00");
  assert.equal(row?.seats, 4);
  assert.equal(row?.hrdcShare, 0.75);
});

// A course with no list price cannot be placed on the price axis, so it is
// absent from that panel rather than plotted at zero.
it("a course with no list price is absent from the price panel", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: null });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "hrdc" });

  const priced = await priceAgainstHrdcShare(viewer, RANGE);
  assert.equal(
    priced.find((r) => r.course === course.name),
    undefined,
  );
  // It is still counted in who pays, where price is a column rather than an axis.
  const funding = (await fundingSplit(viewer, RANGE)).find(
    (r) => r.course === course.name,
  );
  assert.equal(funding?.listPriceMyr, null);
  assert.equal(funding?.hrdc, 1);
});

it("a course with no seats in range is absent, not a divide by zero", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "1500.00" });
  await newClass(course.id);

  const rows = await priceAgainstHrdcShare(viewer, RANGE);
  assert.equal(
    rows.find((r) => r.course === course.name),
    undefined,
  );
  for (const row of rows) assert.ok(!Number.isNaN(row.hrdcShare));
});

it("a deleted person's seat leaves both panels", async () => {
  const viewer = await newUser("marketing");
  const course = await newCourse({ price: "1800.00" });
  const cls = await newClass(course.id);
  await newEnrolment({ classId: cls, funding: "hrdc" });
  assert.ok(
    (await fundingSplit(viewer, RANGE)).find((r) => r.course === course.name),
  );

  await db()`
    UPDATE person SET deleted_at = now()
    WHERE id IN (SELECT person_id FROM enrolment WHERE class_id = ${cls})`;

  assert.equal(
    (await fundingSplit(viewer, RANGE)).find((r) => r.course === course.name),
    undefined,
  );
  assert.equal(
    (await priceAgainstHrdcShare(viewer, RANGE)).find(
      (r) => r.course === course.name,
    ),
    undefined,
  );
});
