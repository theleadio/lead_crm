// Spec §9.14 against the database: the list's order and the part_time clause
// in SQL, what a row links to per role, create's link and assignee rules, the
// three PATCH actions with If-Match, the one-open-task indexes, the due-time
// rule and the audit rows. Every test makes its own users and records inside
// a rolled-back transaction. Skipped without DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { closeDb, db } from "../lib/sql.ts";
import { listTasks } from "../lib/tasks/list.ts";
import { createTask, updateTask } from "../lib/tasks/service.ts";
import type { TaskWriteResult } from "../lib/tasks/types.ts";
import {
  taskCreateSchema,
  taskListQuerySchema,
  type TaskUpdate,
} from "../lib/validation/task.ts";
import { enrol, newClass, newPerson, newUser } from "./seed.ts";
import { it } from "./seed.ts";

after(closeDb);

// A task as the tests want it; due is a Postgres interval from now().
async function newTask(
  s: {
    assignedTo?: string | null;
    due?: string | null;
    personId?: string | null;
    dealId?: string | null;
    enrolmentId?: string | null;
    type?: string;
    done?: boolean;
    cancelled?: boolean;
  } = {},
): Promise<string> {
  const sql = db();
  const [t] = await sql`
    INSERT INTO task (type, title, person_id, deal_id, enrolment_id,
                      assigned_user_id, due_at, done_at, is_cancelled)
    VALUES (${s.type ?? "follow_up"}, 'Ring back', ${s.personId ?? null},
            ${s.dealId ?? null}, ${s.enrolmentId ?? null},
            ${s.assignedTo ?? null},
            ${s.due === null ? null : sql`now() + ${s.due ?? "1 day"}::interval`},
            ${s.done || s.cancelled ? sql`now()` : null},
            ${s.cancelled ?? false})
    RETURNING id`;
  return t.id as string;
}

async function newDeal(personId: string, ownerId: string | null = null) {
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, owner_user_id)
    VALUES ('individual', 'new', ${personId}, ${ownerId})
    RETURNING id`;
  return d.id as string;
}

const list = (viewer: Viewer, q: Record<string, string> = {}) =>
  listTasks(taskListQuerySchema.parse(q), viewer);

const create = (viewer: Viewer, body: Record<string, unknown>) =>
  createTask(
    taskCreateSchema.parse({ type: "call", title: "Call", ...body }),
    viewer,
  );

const versionOf = async (id: string) =>
  Number((await db()`SELECT version FROM task WHERE id = ${id}`)[0].version);

const patch = async (viewer: Viewer, id: string, body: TaskUpdate) =>
  updateTask(id, body, await versionOf(id), viewer);

function ok(r: TaskWriteResult) {
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as Extract<TaskWriteResult, { kind: "ok" }>).task;
}

// --- The list -----------------------------------------------------------

it("my open tasks: overdue first, then later, no due time last", async () => {
  const me = await newUser("sales");
  const person = await newPerson("Task Order");
  const later = await newTask({
    assignedTo: me.id,
    due: "1 day",
    personId: person,
  });
  const none = await newTask({
    assignedTo: me.id,
    due: null,
    personId: person,
  });
  const overdue = await newTask({
    assignedTo: me.id,
    due: "-1 day",
    personId: person,
  });
  await newTask({ assignedTo: me.id, due: "-2 days", done: true });
  await newTask({ assignedTo: (await newUser("sales")).id, due: "-3 days" });

  const { data, page } = await list(me);
  assert.deepEqual(
    data.map((t) => t.id),
    [overdue, later, none],
  );
  assert.equal(page.total, 3);
  assert.equal(data[0].isOverdue, true);
  assert.equal(data[1].isOverdue, false);
  assert.equal(data[0].about?.href, `/people/${person}`);
});

it("a part-timer gets only their own tasks, whatever the filters say", async () => {
  const pt = await newUser("part_time");
  const mine = await newTask({ assignedTo: pt.id });
  const other = await newTask({ assignedTo: (await newUser("sales")).id });
  const unassigned = await newTask({ assignedTo: null });

  const queries: Record<string, string>[] = [
    { mine: "false" },
    { mine: "false", assignee: "unassigned" },
  ];
  for (const q of queries) {
    const ids = (await list(pt, q)).data.map((t) => t.id);
    assert.ok(
      !ids.includes(other) && !ids.includes(unassigned),
      JSON.stringify(q),
    );
  }
  assert.deepEqual(
    (await list(pt, { mine: "false" })).data
      .map((t) => t.id)
      .filter((id) => id === mine),
    [mine],
  );
});

it("everyone's view filters by unassigned and by type", async () => {
  const lead = await newUser("sales");
  const unassigned = await newTask({ assignedTo: null, type: "call" });
  const assigned = await newTask({ assignedTo: lead.id, type: "call" });
  const ids = (
    await list(lead, { mine: "false", assignee: "unassigned", type: "call" })
  ).data.map((t) => t.id);
  assert.ok(ids.includes(unassigned));
  assert.ok(!ids.includes(assigned));
});

it("about: links to what the viewer may read, and hides what they may not", async () => {
  const classId = await newClass();
  const person = await newPerson("About Person");
  const enrolmentId = await enrol(classId, "confirmed", { personId: person });
  const marketing = await newUser("marketing");
  const ops = await newUser("operations");
  const id = await newTask({
    assignedTo: marketing.id,
    personId: person,
    enrolmentId,
  });
  await db()`UPDATE task SET assigned_user_id = NULL WHERE id = ${id}`;

  const asMarketing = (await list(marketing, { mine: "false" })).data.find(
    (t) => t.id === id,
  )!;
  assert.equal(asMarketing.about?.href, `/people/${person}`);
  assert.equal(asMarketing.about?.detail, null);

  const asOps = (await list(ops, { mine: "false" })).data.find(
    (t) => t.id === id,
  )!;
  assert.equal(asOps.about?.href, `/enrolments/${enrolmentId}`);
  assert.match(asOps.about?.detail ?? "", /^C-/);
});

it("a part-timer's task about a deal links to the person, no course", async () => {
  const pt = await newUser("part_time");
  const person = await newPerson("Deal Person");
  const dealId = await newDeal(person);
  const id = await newTask({ assignedTo: pt.id, personId: person, dealId });
  const row = (await list(pt)).data.find((t) => t.id === id)!;
  assert.equal(row.about?.href, `/people/${person}`);
  assert.equal(row.about?.detail, null);
});

// --- Create -------------------------------------------------------------

it("a deal task carries the deal's person and is audited without its text", async () => {
  const sales = await newUser("sales");
  const person = await newPerson("Create Deal");
  const dealId = await newDeal(person);
  const task = ok(
    await create(sales, { dealId, title: "Secret words", assignee: sales.id }),
  );
  const [row] =
    await db()`SELECT person_id, deal_id, created_by FROM task WHERE id = ${task.id}`;
  assert.equal(row.person_id, person);
  assert.equal(row.deal_id, dealId);
  assert.equal(row.created_by, sales.id);

  const [audit] = await db()`
    SELECT after FROM audit_log WHERE entity = 'task' AND entity_id = ${task.id}
      AND action = 'create'`;
  assert.equal(audit.after.type, "call");
  assert.equal("title" in audit.after, false);
  assert.ok(!JSON.stringify(audit.after).includes("Secret words"));
});

it("an inactive assignee is refused", async () => {
  const sales = await newUser("sales");
  const gone = await newUser("sales");
  await db()`UPDATE app_user SET is_active = false WHERE id = ${gone.id}`;
  const r = await create(sales, {
    personId: await newPerson("P"),
    assignee: gone.id,
  });
  assert.equal(r.kind, "inactive_user");
});

it("a part-timer's task is theirs, and only on a person they can see", async () => {
  const pt = await newUser("part_time");
  const other = await newUser("sales");
  const theirs = await newPerson("Theirs");
  await db()`UPDATE person SET owner_user_id = ${pt.id} WHERE id = ${theirs}`;
  const task = ok(await create(pt, { personId: theirs, assignee: other.id }));
  assert.equal(task.assignedUserId, pt.id);

  const stranger = await newPerson("Stranger");
  assert.equal((await create(pt, { personId: stranger })).kind, "not_found");
  // No deal access at all (§6 deal row "-").
  assert.equal(
    (await create(pt, { dealId: await newDeal(theirs) })).kind,
    "not_found",
  );
});

it("marketing cannot hang a task on an enrolment it cannot read", async () => {
  const marketing = await newUser("marketing");
  const enrolmentId = await enrol(await newClass(), "confirmed");
  assert.equal((await create(marketing, { enrolmentId })).kind, "not_found");
});

// --- Complete, reopen, edit -----------------------------------------------

it("complete then reopen puts the task back as it was", async () => {
  const sales = await newUser("sales");
  const id = await newTask({ assignedTo: sales.id, due: "2 hours" });
  const [before] = await db()`SELECT due_at FROM task WHERE id = ${id}`;

  const done = ok(await patch(sales, id, { action: "complete" }));
  assert.equal(done.isDone, true);
  const [closed] =
    await db()`SELECT done_at, done_by FROM task WHERE id = ${id}`;
  assert.ok(closed.done_at);
  assert.equal(closed.done_by, sales.id);
  assert.ok(!(await list(sales)).data.some((t) => t.id === id));

  const open = ok(await patch(sales, id, { action: "reopen" }));
  assert.equal(open.isDone, false);
  assert.equal(open.assignedUserId, sales.id);
  assert.equal(+new Date(open.dueAt!), +before.due_at);

  const audits = await db()`
    SELECT after FROM audit_log WHERE entity = 'task' AND entity_id = ${id}
      AND action = 'update' ORDER BY created_at, id`;
  assert.equal(audits.length, 2);
});

it("a stale version is refused and changes nothing", async () => {
  const sales = await newUser("sales");
  const id = await newTask({ assignedTo: sales.id });
  const v = await versionOf(id);
  ok(await updateTask(id, { action: "edit", title: "First" }, v, sales));
  const r = await updateTask(id, { action: "complete" }, v, sales);
  assert.equal(r.kind, "stale");
  const [row] = await db()`SELECT done_at FROM task WHERE id = ${id}`;
  assert.equal(row.done_at, null);
});

it("a part-timer cannot touch someone else's task, or hand theirs on", async () => {
  const pt = await newUser("part_time");
  const other = await newUser("sales");
  const theirs = await newTask({ assignedTo: other.id });
  assert.equal(
    (await patch(pt, theirs, { action: "complete" })).kind,
    "not_found",
  );

  const mine = await newTask({ assignedTo: pt.id });
  assert.equal(
    (await patch(pt, mine, { action: "edit", assignee: other.id })).kind,
    "forbidden",
  );
});

it("a withdrawn task cannot be reopened", async () => {
  const sales = await newUser("sales");
  const id = await newTask({ assignedTo: sales.id, cancelled: true });
  const r = await patch(sales, id, { action: "reopen" });
  assert.equal(r.kind, "conflict");
});

it("reopening an HRDC reminder when the deal has a newer one is refused", async () => {
  const sales = await newUser("sales");
  const person = await newPerson("Hrdc");
  const dealId = await newDeal(person, sales.id);
  const old = await newTask({
    type: "hrdc_deadline",
    dealId,
    personId: person,
    done: true,
  });
  await newTask({ type: "hrdc_deadline", dealId, personId: person });
  const r = await patch(sales, old, { action: "reopen" });
  assert.equal(r.kind, "conflict");
  // The refusal left the caller's transaction usable.
  const [row] = await db()`SELECT done_at FROM task WHERE id = ${old}`;
  assert.ok(row.done_at);
});

it("an HRDC reminder's due date cannot be edited here", async () => {
  const sales = await newUser("sales");
  const person = await newPerson("Hrdc Due");
  const id = await newTask({
    type: "hrdc_deadline",
    dealId: await newDeal(person, sales.id),
    personId: person,
  });
  const r = await patch(sales, id, {
    action: "edit",
    dueDate: "2026-12-01",
    dueTime: null,
  });
  assert.equal(r.kind, "due_locked");
});

it("edit: reassign bumps the version once and audits ids, not text", async () => {
  const support = await newUser("support");
  const next = await newUser("sales");
  const id = await newTask({ assignedTo: support.id });
  const v = await versionOf(id);
  ok(
    await updateTask(
      id,
      { action: "edit", title: "New secret", assignee: next.id },
      v,
      support,
    ),
  );
  assert.equal(await versionOf(id), v + 1);
  const [audit] = await db()`
    SELECT before, after FROM audit_log WHERE entity = 'task' AND entity_id = ${id}
      AND action = 'update'`;
  assert.equal(audit.before.assigned_user_id, support.id);
  assert.equal(audit.after.assigned_user_id, next.id);
  assert.deepEqual(audit.after.changed.sort(), ["assigned_user_id", "title"]);
  assert.ok(!JSON.stringify(audit).includes("secret"));
  assert.ok(!JSON.stringify(audit).includes("Ring back"));
});

it("an inactive assignee is refused on edit", async () => {
  const sales = await newUser("sales");
  const gone = await newUser("sales");
  await db()`UPDATE app_user SET is_active = false WHERE id = ${gone.id}`;
  const id = await newTask({ assignedTo: sales.id });
  assert.equal(
    (await patch(sales, id, { action: "edit", assignee: gone.id })).kind,
    "inactive_user",
  );
});

// --- Due time -----------------------------------------------------------

it("a date alone is due at 19:00 Kuala Lumpur, a time is read as KL", async () => {
  const sales = await newUser("sales");
  const personId = await newPerson("Due Time");
  const dateOnly = ok(await create(sales, { personId, dueDate: "2026-11-12" }));
  assert.equal(dateOnly.dueAt, "2026-11-12T11:00:00.000Z");
  assert.equal(dateOnly.dueTime, "19:00");
  assert.equal(dateOnly.dueDate, "2026-11-12");

  const timed = ok(
    await create(sales, { personId, dueDate: "2026-11-12", dueTime: "08:30" }),
  );
  assert.equal(timed.dueAt, "2026-11-12T00:30:00.000Z");

  const none = ok(await create(sales, { personId }));
  assert.equal(none.dueAt, null);
});

it("a task due today with no time is overdue only after 19:00 KL", async () => {
  const sales = await newUser("sales");
  const sql = db();
  const [{ today, past }] = await sql`
    SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS today,
           (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::time >= '19:00' AS past`;
  const task = ok(
    await create(sales, { personId: await newPerson("Today"), dueDate: today }),
  );
  assert.equal(task.isOverdue, past);
});
