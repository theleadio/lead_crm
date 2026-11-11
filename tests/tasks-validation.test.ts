// Spec §7 /api/tasks query and bodies (§9.14).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readTaskParams,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
} from "../lib/validation/task.ts";

const list = (qs: string) =>
  taskListQuerySchema.safeParse(readTaskParams(new URLSearchParams(qs)));

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

test("list: mine by default, 25 rows, and a limit above 100 is refused", () => {
  const ok = list("");
  assert.ok(ok.success);
  assert.equal(ok.data.mine, true);
  assert.equal(ok.data.limit, 25);
  assert.equal(list("filter[mine]=false").data?.mine, false);
  assert.equal(list("limit=500").success, false);
  assert.equal(list("limit=100").success, true);
});

test("list: assignee is an id or 'unassigned', type a known type", () => {
  assert.equal(list("filter[assignee]=unassigned").success, true);
  assert.equal(list("filter[assignee]=abc").success, false);
  assert.equal(list("filter[type]=hrdc_deadline").success, true);
  assert.equal(list("filter[type]=meeting").success, false);
});

test("create: a system type is refused", () => {
  const r = taskCreateSchema.safeParse({
    personId: ID,
    type: "match_payment",
    title: "x",
  });
  assert.equal(r.success, false);
});

test("create: exactly one record to hang the task on", () => {
  const base = { type: "call", title: "Call back" };
  assert.equal(taskCreateSchema.safeParse(base).success, false);
  assert.equal(
    taskCreateSchema.safeParse({ ...base, personId: ID, dealId: ID2 }).success,
    false,
  );
  const ok = taskCreateSchema.safeParse({ ...base, dealId: ID });
  assert.ok(ok.success);
  assert.equal(ok.data.assignee, null);
  assert.equal(ok.data.dueDate, null);
});

test("create: a time without a date is refused on the time field", () => {
  const r = taskCreateSchema.safeParse({
    personId: ID,
    type: "call",
    title: "x",
    dueTime: "14:30",
  });
  assert.equal(r.success, false);
  assert.deepEqual(r.error?.issues[0].path, ["dueTime"]);
  assert.equal(
    taskCreateSchema.safeParse({
      personId: ID,
      type: "call",
      title: "x",
      dueDate: "2026-11-12",
      dueTime: "25:00",
    }).success,
    false,
  );
});

test("create: blank title refused, blank notes become null", () => {
  const base = { personId: ID, type: "other" };
  assert.equal(
    taskCreateSchema.safeParse({ ...base, title: "   " }).success,
    false,
  );
  const r = taskCreateSchema.safeParse({ ...base, title: "x", notes: "  " });
  assert.equal(r.data?.notes, null);
});

test("update: three actions, and edit cannot change type or links", () => {
  assert.ok(taskUpdateSchema.safeParse({ action: "complete" }).success);
  assert.ok(taskUpdateSchema.safeParse({ action: "reopen" }).success);
  assert.equal(taskUpdateSchema.safeParse({ action: "delete" }).success, false);
  const edit = taskUpdateSchema.safeParse({
    action: "edit",
    type: "call",
    dealId: ID,
    assignee: null,
  });
  assert.ok(edit.success);
  assert.equal("type" in edit.data, false);
  assert.equal("dealId" in edit.data, false);
});

test("list: asking for one assignee drops the default 'mine'", () => {
  const r = list(`filter[assignee]=${ID}`);
  assert.equal(r.data?.mine, false);
  assert.equal(r.data?.assignee, ID);
  assert.equal(list("filter[assignee]=unassigned").data?.mine, false);
});

test("ids are lower-cased, so an unchanged id never reads as a change", () => {
  const upper = ID.toUpperCase().replace("0000-4000", "ABCD-4000");
  const r = taskUpdateSchema.safeParse({ action: "edit", assignee: upper });
  assert.ok(r.success);
  assert.equal((r.data as { assignee?: string }).assignee, upper.toLowerCase());
});

test("create: the one-record rule names a field, so its message survives", () => {
  const r = taskCreateSchema.safeParse({ type: "call", title: "x" });
  assert.equal(r.success, false);
  assert.deepEqual(r.error?.issues[0].path, ["personId"]);
});
