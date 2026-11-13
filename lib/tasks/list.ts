import type postgres from "postgres";
import {
  masksContactDetails,
  permissionFor,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { displayName, type ListResponse } from "../people/types.ts";
import { db } from "../sql.ts";
import type { TaskListQuery } from "../validation/task.ts";
import type { TaskAbout, TaskRow } from "./types.ts";

// GET /api/tasks — the §9.14 list: open tasks, earliest due first so overdue
// ones lead, no due time last, ties on id so paging is stable.

type Fragment = postgres.PendingQuery<postgres.Row[]>;
const and = (sql: postgres.Sql, parts: Fragment[]) =>
  parts.reduce((acc, part) => sql`${acc} AND ${part}`);

// Expects task as `t`. The part_time narrowing is here, in the WHERE clause,
// so it bounds the rows and the total alike and no filter can widen it (§6 "A").
function whereSql(sql: postgres.Sql, q: TaskListQuery, viewer: Viewer) {
  const { assignedOnly } = permissionFor(viewer, "task", "read");
  const parts: Fragment[] = [sql`t.done_at IS NULL`];
  if (assignedOnly || q.mine)
    parts.push(sql`t.assigned_user_id = ${viewer.id}`);
  if (q.assignee === "unassigned") parts.push(sql`t.assigned_user_id IS NULL`);
  else if (q.assignee) parts.push(sql`t.assigned_user_id = ${q.assignee}`);
  if (q.type) parts.push(sql`t.type = ${q.type}`);
  return and(sql, parts);
}

// One select for the list and for a single row (the PATCH answer). Times in
// Kuala Lumpur come from the database so the dialog never converts (design 5).
function selectRows(sql: postgres.Sql, where: Fragment, tail: Fragment) {
  return sql`
    SELECT t.id, t.version, t.type, t.title, t.notes, t.assigned_user_id,
           t.due_at, t.done_at,
           to_char(t.due_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS due_date,
           to_char(t.due_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'HH24:MI') AS due_time,
           (t.due_at < now()) AS is_overdue,
           u.full_name AS assignee_name,
           t.enrolment_id, c.code AS class_code,
           t.deal_id, co.name_en AS course_name,
           coalesce(t.person_id, d.person_id, e.person_id) AS person_id,
           coalesce(p.full_name, dp.full_name, ep.full_name) AS person_name,
           coalesce(p.phone, dp.phone, ep.phone) AS person_phone
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assigned_user_id
    LEFT JOIN person p ON p.id = t.person_id
    LEFT JOIN deal d ON d.id = t.deal_id
    LEFT JOIN person dp ON dp.id = d.person_id
    LEFT JOIN course co ON co.id = d.course_id
    LEFT JOIN enrolment e ON e.id = t.enrolment_id
    LEFT JOIN person ep ON ep.id = e.person_id
    LEFT JOIN class c ON c.id = e.class_id
    WHERE ${where}
    ${tail}`;
}

// Design 6: the link goes to the first record the viewer may open, and a
// course or class name from a record they may not read is not shown. A
// part-timer or marketing never lands on a 403 page from here.
export function aboutFor(r: postgres.Row, viewer: Viewer): TaskAbout | null {
  const can = (resource: "enrolment" | "deal" | "person") =>
    permissionFor(viewer, resource, "read").allowed;
  const enrolment = r.enrolment_id && can("enrolment");
  const deal = r.deal_id && can("deal");
  const href = enrolment
    ? `/enrolments/${r.enrolment_id}`
    : deal
      ? `/deals/${r.deal_id}`
      : r.person_id && can("person")
        ? `/people/${r.person_id}`
        : null;
  const detail = enrolment
    ? (r.class_code as string | null)
    : deal
      ? (r.course_name as string | null)
      : null;
  if (!r.person_id && !detail) return null;
  // §6: marketing's phones are masked, so a nameless person stays "Unnamed"
  // rather than showing the real number as a name.
  const phone = masksContactDetails(viewer.role)
    ? null
    : (r.person_phone as string | null);
  return {
    label: r.person_id ? displayName(r.person_name, phone) : "—",
    detail: detail ?? null,
    href,
  };
}

export function toTaskRow(r: postgres.Row, viewer: Viewer): TaskRow {
  return {
    id: r.id as string,
    version: Number(r.version),
    type: r.type as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    about: aboutFor(r, viewer),
    assignedUserId: (r.assigned_user_id as string | null) ?? null,
    assigneeName: (r.assignee_name as string | null) ?? null,
    dueAt: r.due_at ? new Date(r.due_at as string).toISOString() : null,
    dueDate: (r.due_date as string | null) ?? null,
    dueTime: (r.due_time as string | null) ?? null,
    isOverdue: r.is_overdue === true,
    isDone: r.done_at != null,
  };
}

// §6 task row: F R E E E E A. Every role reads; part_time only their own.
export async function listTasks(
  q: TaskListQuery,
  viewer: Viewer,
): Promise<ListResponse<TaskRow>> {
  requirePermission(viewer, "task", "read");
  const sql = db();
  const where = whereSql(sql, q, viewer);
  const [[{ total }], rows] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM task t WHERE ${where}`,
    selectRows(
      sql,
      where,
      sql`ORDER BY t.due_at ASC NULLS LAST, t.id
          LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    ),
  ]);
  return {
    data: rows.map((r) => toTaskRow(r, viewer)),
    page: { total, page: q.page, limit: q.limit },
  };
}

// One row in the list's shape, open or done, for a write's answer. The caller
// has already checked the viewer may see it.
export async function taskRow(
  id: string,
  viewer: Viewer,
): Promise<TaskRow | null> {
  const sql = db();
  const [row] = await selectRows(sql, sql`t.id = ${id}`, sql``);
  return row ? toTaskRow(row, viewer) : null;
}
