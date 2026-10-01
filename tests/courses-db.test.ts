// Spec §7 GET /api/courses (v1.6): all courses by default, `?active=true`
// for pickers; readable by every role on the §6 course row.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { permissionFor, ROLES } from "../lib/auth/permissions.ts";
import { listCourses } from "../lib/courses/service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { courseListQuerySchema } from "../lib/validation/course.ts";

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

const all = { page: 1, limit: 100 };

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
});

test("every role can read courses, part_time included (§6 course row)", () => {
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "me", role }, "class", "read").allowed,
      true,
      role,
    );
});

test("query: active is true/false only; limit capped at 100", () => {
  assert.equal(courseListQuerySchema.parse({ active: "true" }).active, true);
  assert.equal(
    courseListQuerySchema.safeParse({ active: "yes" }).success,
    false,
  );
  assert.equal(
    courseListQuerySchema.safeParse({ limit: "101" }).success,
    false,
  );
  assert.equal(courseListQuerySchema.parse({}).limit, 25);
});
