// Integration tests for the §9.0 Home panels against the seeded dev
// database. Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import {
  myOpenDeals,
  myTasks,
  needsAttention,
  upcomingClasses,
} from "../lib/home/service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// A user created inside the rolled-back transaction owns nothing yet, so
// every count a test asserts is only what that test inserted.
async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newPerson(
  fields: {
    needsReview?: boolean;
    deleted?: boolean;
    mergedInto?: string;
  } = {},
): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name, needs_review, needs_review_reason,
                        deleted_at, merged_into_id)
    VALUES ('Test person', ${fields.needsReview ?? false},
            ${fields.needsReview ? "possible_duplicate_phone" : null},
            ${fields.deleted ? db()`now()` : null}, ${fields.mergedInto ?? null})
    RETURNING id`;
  return p.id;
}

async function newCourse(): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  return c.id;
}

// `days` from today in Kuala Lumpur, which is what §9.0's window counts in.
async function newClass(
  course: string,
  days: number,
  opts: { capacity?: number; status?: string; endDays?: number } = {},
): Promise<string> {
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, status)
    VALUES (${course}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${days}::int,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${opts.endDays ?? days}::int,
            'en', 'online', 'https://example.test/class',
            ${opts.capacity ?? 20}, ${opts.status ?? "open"})
    RETURNING id`;
  return c.id;
}

async function enrol(
  classId: string,
  status: string,
  reservedUntil: "past" | "future" | null = null,
): Promise<void> {
  await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until)
    VALUES (${await newPerson()}, ${classId}, ${status},
            ${
              reservedUntil === "past"
                ? db()`now() - interval '1 hour'`
                : reservedUntil === "future"
                  ? db()`now() + interval '1 day'`
                  : null
            })`;
}

async function newTask(
  user: Viewer,
  dueHours: number | null,
  opts: { done?: boolean; assignee?: string; person?: string } = {},
): Promise<string> {
  const [t] = await db()`
    INSERT INTO task (type, title, assigned_user_id, person_id, due_at,
                      done_at, done_by)
    VALUES ('call', 'Test task', ${opts.assignee ?? user.id},
            ${opts.person ?? null},
            ${dueHours === null ? null : db()`now() + make_interval(hours => ${dueHours})`},
            ${opts.done ? db()`now()` : null}, ${opts.done ? user.id : null})
    RETURNING id`;
  return t.id;
}

async function newDeal(
  owner: Viewer,
  stage: string,
  amount: string,
  pipeline: "individual" | "corporate" = "individual",
): Promise<void> {
  await db()`
    INSERT INTO deal (pipeline, stage, person_id, owner_user_id, amount_myr,
                      won_at, lost_at, lost_reason_id)
    VALUES (${pipeline}, ${stage}, ${await newPerson()}, ${owner.id}, ${amount},
            ${stage === "won" ? db()`now()` : null},
            ${stage === "lost" ? db()`now()` : null},
            ${stage === "lost" ? db()`(SELECT id FROM lost_reason WHERE is_active LIMIT 1)` : null})`;
}

// --- tasks -----------------------------------------------------------------

it("overdue first, then today; nothing else", async () => {
  const user = await newUser("sales");
  await newTask(user, -48); // two days late
  await newTask(user, -2); // two hours late
  await newTask(user, 2); // later today or tomorrow
  await newTask(user, null); // undated
  await newTask(user, 24 * 7); // next week
  await newTask(user, -24, { done: true }); // completed
  await newTask(user, -24, { assignee: (await newUser("sales")).id }); // someone else's

  const { tasks, overdueCount } = await myTasks(user);

  assert.equal(overdueCount, 2);
  assert.equal(tasks[0].isOverdue, true);
  assert.equal(tasks[1].isOverdue, true);
  // The +2h task only counts when it still lands inside today in KL.
  assert.ok(tasks.length === 2 || (tasks.length === 3 && !tasks[2].isOverdue));
  assert.ok(new Date(tasks[0].dueAt) < new Date(tasks[1].dueAt));
});

it("a task row links to the record it hangs off", async () => {
  const user = await newUser("support");
  const person = await newPerson();
  await newTask(user, -1, { person });

  const { tasks } = await myTasks(user);
  assert.equal(tasks[0].href, `/people/${person}`);
  assert.equal(tasks[0].who, "Test person");
});

it("a part-timer is asked only for their own tasks", async () => {
  const partTimer = await newUser("part_time");
  const other = await newUser("sales");
  await newTask(other, -3);
  await newTask(partTimer, -1);

  const { tasks } = await myTasks(partTimer);
  assert.equal(tasks.length, 1);
});

// --- deals -----------------------------------------------------------------

it("totals cover every owned deal, won and lost excluded", async () => {
  const user = await newUser("sales");
  for (let i = 0; i < 30; i++) await newDeal(user, "new", "100.50");
  await newDeal(user, "engaged", "1000.00");
  await newDeal(user, "won", "9000.00");
  await newDeal(user, "lost", "4000.00");
  await newDeal(user, "discovery", "500.00", "corporate");

  const [individual, corporate] = await myOpenDeals(user);

  assert.equal(individual.pipeline, "individual");
  assert.equal(individual.openCount, 31);
  assert.equal(individual.openTotalMyr, "4015.00");
  assert.ok(!individual.stages.some((s) => ["won", "lost"].includes(s.stage)));
  assert.deepEqual(
    individual.stages.map((s) => s.stage),
    ["new", "engaged", "qualified", "checkout_sent"],
  );
  assert.equal(corporate.openCount, 1);
  assert.equal(corporate.openTotalMyr, "500.00");
});

it("a colleague's deal is not in my totals", async () => {
  const me = await newUser("sales");
  const colleague = await newUser("sales");
  await newDeal(colleague, "engaged", "7000.00");

  const [individual] = await myOpenDeals(me);
  assert.equal(individual.openCount, 0);
  assert.equal(individual.openTotalMyr, "0.00");
});

// --- classes ---------------------------------------------------------------

it("the window is today to 14 days, cancelled and started excluded", async () => {
  const user = await newUser("operations");
  const course = await newCourse();
  const today = await newClass(course, 0);
  const edge = await newClass(course, 14);
  await newClass(course, 15);
  await newClass(course, -7, { endDays: 7 });
  await newClass(course, 3, { status: "cancelled" });

  const found = (await upcomingClasses(user)).filter(
    (c) => c.courseName === "Test course",
  );
  assert.deepEqual(
    found.map((c) => c.id),
    [today, edge],
  );
});

it("seats sold follows §12.1", async () => {
  const user = await newUser("operations");
  const course = await newCourse();
  const classId = await newClass(course, 2, { capacity: 20 });
  for (const status of ["confirmed", "confirmed", "onboarded", "attended"])
    await enrol(classId, status);
  await enrol(classId, "reserved", "future");
  await enrol(classId, "reserved", "past"); // expired: frees its seat
  await enrol(classId, "waitlisted");
  await enrol(classId, "cancelled");
  await enrol(classId, "refunded");

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.equal(found?.sold, 5);
  assert.equal(found?.capacity, 20);
});

// --- needs attention -------------------------------------------------------

it("flagged people count; deleted and merged ones do not", async () => {
  const user = await newUser("sales");
  const before = (await needsAttention(user)).needsReview ?? 0;
  const survivor = await newPerson();
  await newPerson({ needsReview: true });
  await newPerson({ needsReview: true, deleted: true });
  await newPerson({ needsReview: true, mergedInto: survivor });

  assert.equal((await needsAttention(user)).needsReview, before + 1);
});

// §9.0: a row per item, each gated on its own permission. Operations approves
// notices (§9.10) and only reads people, so it sees one count and not the other.
it("each needs-attention item is counted only for the roles that can act", async () => {
  const ops = await newUser("operations");
  const sales = await newUser("sales");
  const classId = await newClass(await newCourse(), 7);
  const before = (await needsAttention(ops)).pendingNotices ?? 0;
  await db()`
    INSERT INTO class_notice (class_id, changed_fields, recipient_count)
    VALUES (${classId}, ${db().json({ startDate: { from: "2026-10-06", to: "2026-10-13" } })}, 3)`;

  const forOps = await needsAttention(ops);
  assert.equal(forOps.pendingNotices, before + 1);
  assert.equal(forOps.needsReview, null);

  const forSales = await needsAttention(sales);
  assert.equal(forSales.pendingNotices, null);
  assert.equal(typeof forSales.needsReview, "number");
});

// --- permissions -----------------------------------------------------------

it("§6 decides which panels a role may read", async () => {
  const partTimer = await newUser("part_time");
  const management = await newUser("management");
  const marketing = await newUser("marketing");

  await assert.rejects(() => myOpenDeals(partTimer), PermissionError);
  await assert.rejects(() => needsAttention(partTimer), PermissionError);
  // Read-only on people: no queue to work through (§6).
  await assert.rejects(() => needsAttention(management), PermissionError);
  // Marketing reads deals and writes tasks, so both panels load.
  await myOpenDeals(marketing);
  await myTasks(marketing);
  await upcomingClasses(partTimer);
});
