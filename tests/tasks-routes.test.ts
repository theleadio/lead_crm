// Spec §9.14 / §7 / §6: what the task routes answer. No database and no
// session: a route is `getCurrentUser` plus the §6 gate, the schema, the
// service and one response per result, and the gate, If-Match and the
// response mapping are what this file checks. The writes themselves are
// checked against the database in `tasks-db`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readIfMatch } from "../lib/api/errors.ts";
import { ROLES, permissionFor } from "../lib/auth/permissions.ts";
import { taskWriteResponse } from "../lib/tasks/responses.ts";

test("§6 task row: every role reads, management and nobody else is read-only", () => {
  for (const role of ROLES) {
    const viewer = { id: "u", role };
    assert.ok(permissionFor(viewer, "task", "read").allowed, role);
    assert.equal(
      permissionFor(viewer, "task", "write").allowed,
      role !== "management",
      role,
    );
  }
  const pt = permissionFor({ id: "u", role: "part_time" }, "task", "write");
  assert.equal(pt.assignedOnly, true);
});

test("PATCH without a usable If-Match is a 428, never a blind save", () => {
  const req = (h?: string) =>
    new Request("http://x/api/tasks/1", {
      method: "PATCH",
      headers: h ? { "If-Match": h } : {},
    });
  assert.equal(readIfMatch(req()), null);
  assert.equal(readIfMatch(req("abc")), null);
  assert.equal(readIfMatch(req("0")), null);
  assert.equal(readIfMatch(req("3")), 3);
});

test("each write result has one status and code", async () => {
  const cases: [Parameters<typeof taskWriteResponse>[0], number, string][] = [
    [{ kind: "not_found" }, 404, "not_found"],
    [{ kind: "stale" }, 409, "stale_edit"],
    [{ kind: "conflict", message: "Already done." }, 409, "conflict"],
    [{ kind: "inactive_user" }, 422, "inactive_user"],
    [{ kind: "due_locked" }, 422, "due_locked"],
  ];
  for (const [result, status, code] of cases) {
    const res = taskWriteResponse(result, 200);
    assert.equal(res.status, status, result.kind);
    assert.equal((await res.json()).error.code, code, result.kind);
  }
  const conflict = await taskWriteResponse(
    { kind: "conflict", message: "Already done." },
    200,
  ).json();
  assert.equal(conflict.error.message, "Already done.");
  const due = await taskWriteResponse({ kind: "due_locked" }, 200).json();
  assert.ok(due.error.fields.dueDate);
});

test("a create answers 201 with the task", async () => {
  const task = {
    id: "t",
    version: 1,
    type: "call",
    title: "Call",
    notes: null,
    about: null,
    assignedUserId: null,
    assigneeName: null,
    dueAt: null,
    dueDate: null,
    dueTime: null,
    isOverdue: false,
    isDone: false,
  };
  const res = taskWriteResponse({ kind: "ok", task }, 201);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, "t");
});
