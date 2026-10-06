// Spec §9.8 Classes list, §12.1 seats: what GET /api/classes reports for a
// class, which classes the upcoming and past views hold, and that the list
// reports the stored status rather than deriving one of its own.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { listClasses } from "../lib/classes/service.ts";
import {
  PermissionError,
  ROLES,
  type Viewer,
} from "../lib/auth/permissions.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { classListQuerySchema } from "../lib/validation/class-query.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const ops: Viewer = {
  id: "00000000-0000-0000-0000-000000000000",
  role: "operations",
};
const query = (input: Record<string, string | number> = {}) =>
  classListQuerySchema.parse(input);

async function newCourse(nameEn = "Test course"): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, ${nameEn}, 'workshop', 1)
    RETURNING id`;
  return c.id;
}

type ClassInput = {
  courseId: string;
  startOffset?: number;
  endOffset?: number;
  status?: string;
  capacity?: number;
  language?: string;
  mode?: string;
  code?: string;
};

// Offsets are days from today in Kuala Lumpur, the same day the service
// compares against (§4).
async function newClass(input: ClassInput): Promise<string> {
  const {
    courseId,
    startOffset = 7,
    endOffset = startOffset,
    status = "open",
    capacity = 10,
    language = "en",
    mode = "in_person",
    code = `C-${crypto.randomUUID()}`,
  } = input;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, start_time,
                       end_time, language, mode, venue_name, venue_address,
                       city, online_url,
                       capacity, status, is_public)
    VALUES (${courseId}, ${code},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${startOffset}::int,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${endOffset}::int,
            '09:00', '17:00', ${language}, ${mode},
            ${mode === "online" ? null : "LEAD Training Centre"},
            ${mode === "online" ? null : "1 Jalan Test, 50000"},
            ${mode === "online" ? null : "Kuala Lumpur"},
            ${mode === "in_person" ? null : "https://meet.lead.test/secret"},
            ${capacity}, ${status}, true)
    RETURNING id`;
  return c.id;
}

// `reservedOffset` is a Postgres interval ("2 days", "-1 hour"); a live
// reservation holds a seat, an expired one does not (§12.1).
async function enrol(
  classId: string,
  status: string,
  opts: { reservedOffset?: string; transferredTo?: string } = {},
): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Test person') RETURNING id`;
  const [e] = await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until,
                           completed_at, transferred_to_enrolment_id)
    VALUES (${p.id}, ${classId}, ${status},
            now() + ${opts.reservedOffset ?? null}::interval,
            ${status === "completed" ? new Date() : null},
            ${opts.transferredTo ?? null})
    RETURNING id`;
  return e.id;
}

const only = async (
  classId: string,
  when: "upcoming" | "past" = "upcoming",
) => {
  const { data } = await listClasses(query({ when }), ops);
  const row = data.find((c) => c.id === classId);
  assert.ok(row, `class ${classId} missing from the ${when} view`);
  return row;
};

it("seats are counted per §12.1, split into confirmed and reserved", async () => {
  const classId = await newClass({ courseId: await newCourse(), capacity: 10 });
  const stayed = await enrol(classId, "confirmed");
  for (const status of ["payment_pending", "onboarded"])
    await enrol(classId, status);
  await enrol(classId, "reserved", { reservedOffset: "2 days" });
  await enrol(classId, "reserved", { reservedOffset: "-1 hour" });
  for (const status of ["waitlisted", "cancelled", "refunded", "no_show"])
    await enrol(classId, status);
  await enrol(classId, "transferred", { transferredTo: stayed });

  const row = await only(classId);
  assert.equal(row.confirmedCount, 3);
  assert.equal(row.reservedCount, 1);
  assert.equal(row.seatsAvailable, 6);
});

it("a class with only non-seat enrolments is empty", async () => {
  const classId = await newClass({ courseId: await newCourse(), capacity: 4 });
  for (const status of ["waitlisted", "cancelled", "refunded", "no_show"])
    await enrol(classId, status);

  const row = await only(classId);
  assert.equal(row.confirmedCount, 0);
  assert.equal(row.reservedCount, 0);
  assert.equal(row.seatsAvailable, 4);
});

it("an oversold class reports no seats left, never a negative number", async () => {
  // Oversold by lowering the capacity, not by overbooking: migration 006
  // refuses the enrolment that would take the fourth seat, while a capacity
  // edit below the seats taken is only refused by the service (§9.9), so an
  // import or SQL can still leave the row in this state.
  const classId = await newClass({ courseId: await newCourse(), capacity: 3 });
  for (let i = 0; i < 3; i++) await enrol(classId, "confirmed");
  await db()`UPDATE class SET capacity = 1 WHERE id = ${classId}`;

  const row = await only(classId);
  assert.equal(row.confirmedCount, 3);
  assert.equal(row.seatsAvailable, 0);
});

it("the stored status is reported, never one derived from the seats", async () => {
  const courseId = await newCourse();
  const draftId = await newClass({ courseId, status: "draft" });
  const cancelledId = await newClass({ courseId, status: "cancelled" });

  assert.equal((await only(draftId)).status, "draft");
  const cancelled = await only(cancelledId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.seatsAvailable, 10);
});

it("an online class has no venue and never reports its url", async () => {
  const classId = await newClass({
    courseId: await newCourse(),
    mode: "online",
  });
  const row = await only(classId);
  assert.equal(row.venueName, null);
  assert.equal(row.city, null);
  assert.equal(row.mode, "online");
  assert.ok(!("onlineUrl" in row));
  assert.ok(!JSON.stringify(row).includes("meet.lead.test"));
  assert.equal(row.startTime, "09:00");
  assert.match(row.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(row.version >= 1);
});

it("a class in progress is upcoming, not past", async () => {
  const classId = await newClass({
    courseId: await newCourse(),
    startOffset: -1,
    endOffset: 1,
  });
  await only(classId, "upcoming");

  const past = await listClasses(query({ when: "past" }), ops);
  assert.ok(!past.data.some((c) => c.id === classId));
});

it("the past view holds finished classes, most recent first", async () => {
  const courseId = await newCourse();
  const older = await newClass({ courseId, startOffset: -30, endOffset: -30 });
  const recent = await newClass({ courseId, startOffset: -3, endOffset: -2 });

  const { data } = await listClasses(query({ when: "past" }), ops);
  const ids = data.map((c) => c.id);
  assert.ok(ids.includes(older) && ids.includes(recent));
  assert.ok(ids.indexOf(recent) < ids.indexOf(older));

  const upcoming = await listClasses(query(), ops);
  assert.ok(!upcoming.data.some((c) => c.id === recent));
});

it("the course filter narrows the list and still honours the view", async () => {
  const mine = await newCourse("Filter course");
  const other = await newCourse();
  const upcoming = await newClass({ courseId: mine });
  const finished = await newClass({
    courseId: mine,
    startOffset: -10,
    endOffset: -10,
  });
  await newClass({ courseId: other });

  const filtered = await listClasses(query({ courseId: mine }), ops);
  assert.deepEqual(
    filtered.data.map((c) => c.id),
    [upcoming],
  );
  assert.equal(filtered.page.total, 1);
  assert.equal(filtered.data[0].courseName, "Filter course");

  const past = await listClasses(query({ when: "past", courseId: mine }), ops);
  assert.deepEqual(
    past.data.map((c) => c.id),
    [finished],
  );
});

it("the status and language filters find what they name", async () => {
  const courseId = await newCourse();
  const cancelled = await newClass({ courseId, status: "cancelled" });
  await newClass({ courseId, status: "open" });
  const chinese = await newClass({ courseId, language: "zh" });

  // Scoped to this test's own course: the filters are what is under test, and
  // a seeded or hand-cancelled class elsewhere must not decide the result.
  const byStatus = await listClasses(
    query({ status: "cancelled", courseId }),
    ops,
  );
  assert.deepEqual(
    byStatus.data.map((c) => c.id),
    [cancelled],
  );
  const byLanguage = await listClasses(
    query({ language: "zh", courseId }),
    ops,
  );
  assert.deepEqual(
    byLanguage.data.map((c) => c.id),
    [chinese],
  );
});

it("each sort orders as it says, and paging a tie-heavy set repeats nothing", async () => {
  const courseId = await newCourse("Aaa course");
  const otherCourse = await newCourse("Zzz course");
  const prefix = `S${crypto.randomUUID().slice(0, 8)}-`;
  const codes = [1, 2, 3, 4].map((n) => `${prefix}${n}`);
  for (const code of codes) await newClass({ courseId, code, startOffset: 5 });
  await newClass({ courseId: otherCourse, code: `Z${prefix}`, startOffset: 5 });

  const byCode = await listClasses(query({ sort: "code", limit: 100 }), ops);
  const seen = byCode.data
    .map((c) => c.code)
    .filter((c) => c.startsWith(prefix));
  assert.deepEqual(seen, codes);

  const byCodeDesc = await listClasses(
    query({ sort: "-code", limit: 100 }),
    ops,
  );
  assert.deepEqual(
    byCodeDesc.data.map((c) => c.code).filter((c) => c.startsWith(prefix)),
    [...codes].reverse(),
  );

  const byCourse = await listClasses(
    query({ sort: "course", limit: 100 }),
    ops,
  );
  const names = byCourse.data.map((c) => c.courseName);
  assert.ok(names.indexOf("Aaa course") < names.indexOf("Zzz course"));

  const first = await listClasses(query({ limit: 2, page: 1 }), ops);
  const second = await listClasses(query({ limit: 2, page: 2 }), ops);
  const ids = [...first.data, ...second.data].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(first.page.total, second.page.total);
});

it("every role may read the schedule, and a role without class read may not", async () => {
  await newClass({ courseId: await newCourse() });
  for (const role of ROLES) await listClasses(query(), { id: ops.id, role });

  await assert.rejects(
    () => listClasses(query(), { id: ops.id, role: "nobody" as never }),
    PermissionError,
  );
});
