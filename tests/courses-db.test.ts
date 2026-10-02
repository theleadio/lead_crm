// Spec §7 GET/POST/PATCH /api/courses, §9.7: all courses by default,
// `?active=true` for pickers; every role reads, super_admin and operations
// write (§6 course row).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  canWriteCourse,
  permissionFor,
  ROLES,
} from "../lib/auth/permissions.ts";
import {
  createCourse,
  listCourses,
  updateCourse,
} from "../lib/courses/service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import {
  courseCreateSchema,
  courseListQuerySchema,
  courseUpdateSchema,
} from "../lib/validation/course.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

async function newCourse(isActive: boolean): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, is_active)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1, ${isActive})
    RETURNING id`;
  return c.id;
}

// A real app_user, because create/update write created_by and audit rows.
async function newUser(role: string): Promise<{ id: string; role: never }> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role: role as never };
}

const all = { page: 1, limit: 100 };
const VALID = {
  nameEn: "AI Agentic Automation",
  track: "certification" as const,
  durationDays: 2,
  hrdcClaimable: true,
  isActive: true,
};

it("list: inactive courses included by default, excluded with active=true", async () => {
  const active = await newCourse(true);
  const retired = await newCourse(false);

  const everything = await listCourses(all);
  assert.equal(everything.data.find((c) => c.id === active)?.isActive, true);
  assert.equal(everything.data.find((c) => c.id === retired)?.isActive, false);

  const activeOnly = await listCourses({ ...all, active: true });
  assert.ok(activeOnly.data.some((c) => c.id === active));
  assert.ok(!activeOnly.data.some((c) => c.id === retired));
  assert.ok(activeOnly.page.total < everything.page.total);

  // active=false is the 9.7 screen's "Retired only", not "no filter".
  const retiredOnly = await listCourses({ ...all, active: false });
  assert.ok(retiredOnly.data.some((c) => c.id === retired));
  assert.ok(!retiredOnly.data.some((c) => c.id === active));
  assert.equal(
    retiredOnly.page.total + activeOnly.page.total,
    everything.page.total,
  );
});

it("list: a fresh course has version 1, returned as a number (§7 v1.7)", async () => {
  const id = await newCourse(true);
  const row = (await listCourses(all)).data.find((c) => c.id === id);
  assert.equal(row?.version, 1);
  assert.equal(typeof row?.version, "number");
});

it("list: sort=code and -code order by code, ties broken on id", async () => {
  await newCourse(true);
  const up = (await listCourses({ ...all, sort: "code" })).data.map(
    (c) => c.code,
  );
  const down = (await listCourses({ ...all, sort: "-code" })).data.map(
    (c) => c.code,
  );
  assert.deepEqual(up, [...up].sort());
  assert.deepEqual(down, [...up].reverse());
});

it("create: inserts the §9.7 fields and audits it", async () => {
  const ops = await newUser("operations");
  const code = `C-${crypto.randomUUID().slice(0, 8)}`;
  const result = await createCourse(
    { ...VALID, code, nameZh: "中文名", listPriceMyr: "3200.00" },
    ops,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.version, 1);

  const [row] = await db()`SELECT * FROM course WHERE id = ${result.id}`;
  assert.equal(row.code, code);
  assert.equal(row.name_zh, "中文名");
  assert.equal(row.list_price_myr, "3200.00");
  assert.equal(row.hrdc_claimable, true);
  assert.equal(row.created_by, ops.id);

  const [audit] = await db()`
    SELECT action FROM audit_log WHERE entity = 'course' AND entity_id = ${result.id}`;
  assert.equal(audit.action, "create");
});

it("create: a blank price is stored as no price, not zero", async () => {
  const ops = await newUser("operations");
  const result = await createCourse(
    {
      ...VALID,
      code: `C-${crypto.randomUUID().slice(0, 8)}`,
      listPriceMyr: "",
    },
    ops,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  const [row] =
    await db()`SELECT list_price_myr FROM course WHERE id = ${result.id}`;
  assert.equal(row.list_price_myr, null);
});

it("create: a duplicate code names the holder, even a retired one", async () => {
  const ops = await newUser("operations");
  const code = `C-${crypto.randomUUID().slice(0, 8)}`;
  await db()`
    INSERT INTO course (code, name_en, track, duration_days, is_active)
    VALUES (${code}, 'Retired course', 'workshop', 1, false)`;

  const result = await createCourse({ ...VALID, code }, ops);
  assert.equal(result.kind, "duplicate");
  if (result.kind !== "duplicate") return;
  assert.equal(result.nameEn, "Retired course");

  const [{ count }] = await db()`
    SELECT count(*)::int AS count FROM course WHERE code = ${code}`;
  assert.equal(count, 1);
});

it("create: the code is stored trimmed (§8.2 matches on it)", async () => {
  const ops = await newUser("operations");
  const bare = `C-${crypto.randomUUID().slice(0, 8)}`;
  const parsed = courseCreateSchema.parse({ ...VALID, code: `  ${bare}  ` });
  const result = await createCourse(parsed, ops);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  const [row] = await db()`SELECT code FROM course WHERE id = ${result.id}`;
  assert.equal(row.code, bare);
});

it("create/update: sales may not write, operations may", async () => {
  const sales = await newUser("sales");
  const code = `C-${crypto.randomUUID().slice(0, 8)}`;
  assert.equal(
    (await createCourse({ ...VALID, code }, sales)).kind,
    "forbidden",
  );
  const id = await newCourse(true);
  assert.equal(
    (await updateCourse(id, { nameEn: "Nope" }, 1, sales)).kind,
    "forbidden",
  );
  const [{ count }] = await db()`
    SELECT count(*)::int AS count FROM course WHERE code = ${code}`;
  assert.equal(count, 0);
});

it("update: a price-only save leaves every other field and the descriptions alone", async () => {
  const ops = await newUser("operations");
  const [created] = await db()`
    INSERT INTO course (code, name_en, name_zh, track, duration_days,
                        hrdc_claimable, description_en)
    VALUES (${`C-${crypto.randomUUID().slice(0, 8)}`}, 'Keep me', '保留',
            'mastery', 3, true, 'Long blurb')
    RETURNING id, version`;

  const result = await updateCourse(
    created.id,
    { listPriceMyr: "4500" },
    Number(created.version),
    ops,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.version, Number(created.version) + 1);

  const [row] = await db()`SELECT * FROM course WHERE id = ${created.id}`;
  assert.equal(row.list_price_myr, "4500.00");
  assert.equal(row.name_en, "Keep me");
  assert.equal(row.name_zh, "保留");
  assert.equal(row.track, "mastery");
  assert.equal(row.duration_days, 3);
  assert.equal(row.hrdc_claimable, true);
  assert.equal(row.is_active, true);
  assert.equal(row.description_en, "Long blurb");
});

it("update: the wrong version is stale and writes nothing", async () => {
  const ops = await newUser("operations");
  const id = await newCourse(true);
  const first = await updateCourse(id, { nameEn: "First save" }, 1, ops);
  assert.equal(first.kind, "ok");

  const second = await updateCourse(id, { nameEn: "Second save" }, 1, ops);
  assert.equal(second.kind, "stale");
  const [row] = await db()`SELECT name_en FROM course WHERE id = ${id}`;
  assert.equal(row.name_en, "First save");
  const [{ count }] = await db()`
    SELECT count(*)::int AS count FROM audit_log
    WHERE entity = 'course' AND entity_id = ${id} AND action = 'update'`;
  assert.equal(count, 1);
});

it("update: a course that is gone is not_found, not stale", async () => {
  const ops = await newUser("operations");
  const id = await newCourse(true);
  await db()`DELETE FROM course WHERE id = ${id}`;
  assert.equal(
    (await updateCourse(id, { nameEn: "x" }, 1, ops)).kind,
    "not_found",
  );
  assert.equal(
    (await updateCourse("not-a-uuid", { nameEn: "x" }, 1, ops)).kind,
    "not_found",
  );
});

it("update: moving a code onto another course is a duplicate", async () => {
  const ops = await newUser("operations");
  const taken = `C-${crypto.randomUUID().slice(0, 8)}`;
  await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${taken}, 'Holder', 'workshop', 1)`;
  const id = await newCourse(true);

  const clash = await updateCourse(id, { code: taken }, 1, ops);
  assert.equal(clash.kind, "duplicate");
  if (clash.kind === "duplicate") assert.equal(clash.nameEn, "Holder");

  // Re-sending the course's own code is not a clash.
  const [own] = await db()`SELECT code, version FROM course WHERE id = ${id}`;
  const same = await updateCourse(
    id,
    { code: own.code, nameEn: "Renamed" },
    Number(own.version),
    ops,
  );
  assert.equal(same.kind, "ok");
});

it("update: retiring a course leaves its deals and classes untouched", async () => {
  const ops = await newUser("operations");
  const courseId = await newCourse(true);
  const [person] = await db()`
    INSERT INTO person (full_name) VALUES ('Deal owner') RETURNING id`;
  const [deal] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, course_id)
    VALUES ('individual', 'engaged', ${person.id}, ${courseId})
    RETURNING id, stage, version`;
  const [klass] = await db()`
    INSERT INTO class (code, course_id, start_date, end_date, language, mode,
                       online_url, capacity, status)
    VALUES (${`CL-${crypto.randomUUID().slice(0, 8)}`}, ${courseId},
            current_date + 30, current_date + 31, 'en', 'online',
            'https://lead.test/class', 20, 'open')
    RETURNING id, status, version`;

  const result = await updateCourse(courseId, { isActive: false }, 1, ops);
  assert.equal(result.kind, "ok");

  const [dealAfter] =
    await db()`SELECT stage, version FROM deal WHERE id = ${deal.id}`;
  assert.equal(dealAfter.stage, deal.stage);
  assert.equal(Number(dealAfter.version), Number(deal.version));
  const [classAfter] =
    await db()`SELECT status, version FROM class WHERE id = ${klass.id}`;
  assert.equal(classAfter.status, klass.status);
  assert.equal(Number(classAfter.version), Number(klass.version));

  // Still in the default list for the 9.5 filter, gone from active-only pickers.
  assert.ok((await listCourses(all)).data.some((c) => c.id === courseId));
  assert.ok(
    !(await listCourses({ ...all, active: true })).data.some(
      (c) => c.id === courseId,
    ),
  );
});

test("every role can read courses, part_time included (§6 course row)", () => {
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "me", role }, "class", "read").allowed,
      true,
      role,
    );
});

test("only super_admin and operations write courses (§6 course row)", () => {
  for (const role of ROLES)
    assert.equal(
      canWriteCourse({ id: "me", role }),
      role === "super_admin" || role === "operations",
      role,
    );
});

test("query: active is true/false only; sort is allow-listed; limit capped at 100", () => {
  assert.equal(courseListQuerySchema.parse({ active: "true" }).active, true);
  assert.equal(
    courseListQuerySchema.safeParse({ active: "yes" }).success,
    false,
  );
  assert.equal(courseListQuerySchema.parse({ sort: "-name" }).sort, "-name");
  assert.equal(
    courseListQuerySchema.safeParse({ sort: "list_price_myr" }).success,
    false,
  );
  assert.equal(
    courseListQuerySchema.safeParse({ limit: "101" }).success,
    false,
  );
  assert.equal(courseListQuerySchema.parse({}).limit, 25);
});

test("create schema: required fields, enum track, positive whole duration, money string", () => {
  const bad = courseCreateSchema.safeParse({
    nameEn: "",
    track: "bootcamp",
    durationDays: 0,
  });
  assert.equal(bad.success, false);
  if (!bad.success) {
    const fields = bad.error.issues.map((i) => i.path.join("."));
    for (const f of ["code", "nameEn", "track", "durationDays"])
      assert.ok(fields.includes(f), f);
  }
  const base = { code: "AIA", nameEn: "AI", track: "workshop" as const };
  for (const durationDays of [0, -1, 1.5])
    assert.equal(
      courseCreateSchema.safeParse({ ...base, durationDays }).success,
      false,
      String(durationDays),
    );
  assert.equal(
    courseCreateSchema.safeParse({
      ...base,
      durationDays: 1,
      listPriceMyr: "-5",
    }).success,
    false,
  );
  assert.equal(
    courseCreateSchema.safeParse({
      ...base,
      durationDays: 1,
      listPriceMyr: "3.456",
    }).success,
    false,
  );
  // Defaults: a new course is active, HRDC off unless ticked.
  const ok = courseCreateSchema.parse({ ...base, durationDays: 1 });
  assert.equal(ok.isActive, true);
  assert.equal(ok.hrdcClaimable, false);
  assert.equal(
    courseCreateSchema.parse({ ...base, code: " AIA ", durationDays: 1 }).code,
    "AIA",
  );
});

test("update schema: partial, strict, and never empty", () => {
  assert.equal(courseUpdateSchema.safeParse({}).success, false);
  assert.equal(courseUpdateSchema.safeParse({ isActive: false }).success, true);
  // An unknown key is a 400, not a silently ignored field.
  assert.equal(
    courseUpdateSchema.safeParse({ descriptionEn: "sneaky" }).success,
    false,
  );
  assert.equal(
    courseUpdateSchema.safeParse({ durationDays: 0 }).success,
    false,
  );
});
