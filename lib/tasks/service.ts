import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import { permissionFor, type Viewer } from "../auth/permissions.ts";
import { isUuid, visibleSql } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { TaskCreate, TaskUpdate } from "../validation/task.ts";
import { dueAtSql } from "./due.ts";
import { CLOSES_ELSEWHERE } from "./labels.ts";
import { taskRow } from "./list.ts";
import type { TaskWriteResult } from "./types.ts";

// Every task a person makes or changes goes through here (§9.14, design 1).
// Tasks raised by code keep their own writers: lib/deals/hrdc-task.ts,
// lib/people/duplicate-review.ts, lib/events/handlers.ts.

// Free text about a person: audit_log is append-only and erase_person() can't
// reach it (O35), so these values are never copied into an audit row. The
// row still names them as changed (design 8).
const UNAUDITED = new Set(["title", "notes"]);

async function activeUser(id: string): Promise<boolean> {
  const [row] =
    await db()`SELECT 1 FROM app_user WHERE id = ${id} AND is_active`;
  return !!row;
}

// The record a new task hangs off, read under the viewer's own rule for it
// (design 7). Returns the person the task is about, or null when the viewer
// cannot see the record (or it does not exist: the answer is the same).
async function linkedPerson(
  input: TaskCreate,
  viewer: Viewer,
): Promise<{ personId: string } | null> {
  const sql = db();
  if (input.personId) {
    if (!permissionFor(viewer, "person", "read").allowed) return null;
    const [p] = await sql`
      SELECT p.id FROM person p
      WHERE p.id = ${input.personId} AND ${visibleSql(sql, viewer)}`;
    return p ? { personId: p.id } : null;
  }
  if (input.dealId) {
    if (!permissionFor(viewer, "deal", "read").allowed) return null;
    const [d] =
      await sql`SELECT person_id FROM deal WHERE id = ${input.dealId}`;
    return d ? { personId: d.person_id } : null;
  }
  if (!permissionFor(viewer, "enrolment", "read").allowed) return null;
  const [e] = await sql`
    SELECT person_id FROM enrolment WHERE id = ${input.enrolmentId!}`;
  return e ? { personId: e.person_id } : null;
}

// POST /api/tasks. The route has checked task write.
// A part-timer's assignee is overwritten, never refused, so create has no
// "forbidden" result.
type CreateResult = Exclude<TaskWriteResult, { kind: "forbidden" }>;

export async function createTask(
  input: TaskCreate,
  viewer: Viewer,
): Promise<CreateResult> {
  const { assignedOnly } = permissionFor(viewer, "task", "write");
  // §6 "A": a part-timer's task is always their own, whatever was sent.
  const assignee = assignedOnly ? viewer.id : input.assignee;
  return withTransaction(async (): Promise<CreateResult> => {
    const linked = await linkedPerson(input, viewer);
    if (!linked) return { kind: "not_found" };
    if (assignee && assignee !== viewer.id && !(await activeUser(assignee)))
      return { kind: "inactive_user" };

    const sql = db();
    const [task] = await sql`
      INSERT INTO task (type, title, person_id, deal_id, enrolment_id,
                        assigned_user_id, due_at, notes, created_by)
      VALUES (${input.type}, ${input.title}, ${linked.personId},
              ${input.dealId ?? null}, ${input.enrolmentId ?? null},
              ${assignee}, ${dueAtSql(sql, input.dueDate, input.dueTime)},
              ${input.notes}, ${viewer.id})
      RETURNING id, due_at`;
    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "task",
      entityId: task.id,
      before: null,
      after: {
        type: input.type,
        person_id: linked.personId,
        deal_id: input.dealId ?? null,
        enrolment_id: input.enrolmentId ?? null,
        assigned_user_id: assignee,
        due_at: task.due_at,
      },
    });
    return { kind: "ok", task: (await taskRow(task.id, viewer))! };
  });
}

type Change = {
  set: Record<string, string | null>;
  // Expressions the database works out: the due time, the done stamp.
  extra?: Record<string, postgres.PendingQuery<postgres.Row[]>>;
};

// One UPDATE with its version check and one audit row (design 3).
async function writeTask(
  id: string,
  ifMatch: number,
  viewer: Viewer,
  change: (before: postgres.Row) => Promise<Change | TaskWriteResult>,
): Promise<TaskWriteResult> {
  const { assignedOnly } = permissionFor(viewer, "task", "write");
  if (!isUuid(id)) return { kind: "not_found" };

  return withTransaction(async (): Promise<TaskWriteResult> => {
    const sql = db();
    const mine = assignedOnly
      ? sql`AND assigned_user_id = ${viewer.id}`
      : sql``;
    // Someone else's task reads as not found to a part-timer, so the
    // refusal does not say whether it exists.
    const [before] = await sql`
      SELECT * FROM task WHERE id = ${id} ${mine} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    // record-concurrency: a stale version is refused before any rule is
    // judged against a row the user has not seen.
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    const result = await change(before);
    if ("kind" in result) return result;
    const { set, extra = {} } = result;
    const columns = Object.keys(set);
    const assignments = [
      ...columns.map((c) => sql`${sql(c)} = ${set[c]}`),
      ...Object.entries(extra).map(([c, v]) => sql`${sql(c)} = ${v}`),
    ].reduce((acc, part) => sql`${acc}, ${part}`);

    let updated: postgres.Row | undefined;
    try {
      // Its own savepoint: a unique violation must not abort the caller's
      // transaction (lib/sql.ts withTransaction). The query must run on the
      // savepoint's db(), not the outer `sql`: postgres.js holds any failed
      // query of a scope against that scope, caught or not.
      [updated] = await withTransaction(
        () => db()`
          UPDATE task SET ${assignments}
          WHERE id = ${id} AND version = ${ifMatch} ${mine}
          RETURNING *`,
      );
    } catch (err) {
      // Design 4: 004 and 009 allow one open hrdc_deadline per deal and one
      // open match_payment per payment. The database decides, not a check.
      if ((err as { code?: string }).code === "23505")
        return {
          kind: "conflict",
          message: `Another open ${before.type === "match_payment" ? "task for this payment" : "reminder for this deal"} already exists, so this one stays closed.`,
        };
      throw err;
    }
    // Read FOR UPDATE above at this version, so this cannot miss; kept so a
    // change to the read can never turn into a silent overwrite.
    if (!updated) return { kind: "stale" };

    const changed = [...columns, ...Object.keys(extra)];
    const valued = changed.filter((c) => !UNAUDITED.has(c));
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "task",
      entityId: id,
      before: Object.fromEntries(valued.map((c) => [c, before[c] ?? null])),
      after: {
        ...Object.fromEntries(valued.map((c) => [c, updated[c] ?? null])),
        changed,
      },
    });
    return { kind: "ok", task: (await taskRow(id, viewer))! };
  });
}

// PATCH /api/tasks/:id. The route has checked task write and If-Match.
export async function updateTask(
  id: string,
  body: TaskUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<TaskWriteResult> {
  const sql = db();
  if (body.action === "complete")
    return writeTask(id, ifMatch, viewer, async (before) => {
      if (before.done_at)
        return { kind: "conflict", message: "This task is already done." };
      const elsewhere = CLOSES_ELSEWHERE[before.type as string];
      if (elsewhere) return { kind: "closes_elsewhere", message: elsewhere };
      return {
        set: { done_by: viewer.id },
        extra: { done_at: sql`now()` },
      };
    });

  if (body.action === "reopen")
    return writeTask(id, ifMatch, viewer, async (before) => {
      if (!before.done_at)
        return { kind: "conflict", message: "This task is already open." };
      // Withdrawn by the HRDC rule (009, S-10): it was never done.
      if (before.is_cancelled)
        return {
          kind: "conflict",
          message: "This task was withdrawn, so it can't be reopened.",
        };
      return { set: { done_at: null, done_by: null } };
    });

  return writeTask(id, ifMatch, viewer, async (before) => {
    if (before.done_at)
      return {
        kind: "conflict",
        message: "This task is done. Reopen it before changing it.",
      };
    const set: Record<string, string | null> = {};
    const extra: Change["extra"] = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.notes !== undefined) set.notes = body.notes;
    if (
      body.assignee !== undefined &&
      body.assignee !== before.assigned_user_id
    ) {
      const { assignedOnly } = permissionFor(viewer, "task", "write");
      if (assignedOnly) return { kind: "forbidden" };
      if (body.assignee && !(await activeUser(body.assignee)))
        return { kind: "inactive_user" };
      set.assigned_user_id = body.assignee;
    }
    if (body.dueDate !== undefined) {
      // §12.6: the reminder's due date follows the deal's deadline.
      if (before.type === "hrdc_deadline") return { kind: "due_locked" };
      extra.due_at = dueAtSql(sql, body.dueDate, body.dueTime);
    }
    if (!Object.keys(set).length && !Object.keys(extra).length)
      return { kind: "ok", task: (await taskRow(id, viewer))! };
    return { set, extra };
  });
}
