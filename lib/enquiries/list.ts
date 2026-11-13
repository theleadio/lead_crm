import type postgres from "postgres";
import type { Viewer } from "../auth/permissions.ts";
import { likeEscape, parsePersonQuery } from "../people/search.ts";
import { displayName, type ListResponse } from "../people/types.ts";
import { db } from "../sql.ts";
import type { EnquiryListQuery } from "../validation/enquiry-query.ts";
import { enquiryAccessSql } from "./access.ts";
import { isPastSla, slaMinutes } from "./sla.ts";
import type {
  EnquiryCategory,
  EnquiryPriority,
  EnquiryRow,
  EnquiryStatus,
} from "./types.ts";

// GET /api/enquiries — the §9.13 queue. One waiting time, from the first
// message or, without one, from when the enquiry was created, shared by the
// age column, the default order, the `age` sort and the SLA (design.md).

type Fragment = postgres.PendingQuery<postgres.Row[]>;
const and = (sql: postgres.Sql, parts: Fragment[]) =>
  parts.reduce((acc, part) => sql`${acc} AND ${part}`);

const waitingSince = (sql: postgres.Sql) =>
  sql`COALESCE(e.first_message_at, e.created_at)`;

// Spec §7 sort=, mapped to fixed fragments — never interpolated. Ties break on
// id so paging is stable. No sort is the §9.13 default: oldest first.
export function orderSql(sql: postgres.Sql, sort: EnquiryListQuery["sort"]) {
  const dir = sort?.startsWith("-") ? sql`DESC` : sql`ASC`;
  switch (sort?.replace("-", "")) {
    case "firstMessage":
      return sql`e.first_message_at ${dir} NULLS LAST, e.id`;
    case "status":
      return sql`e.status ${dir}, ${waitingSince(sql)}, e.id`;
    case "age":
      return sql`${waitingSince(sql)} ${dir}, e.id`;
    default:
      return sql`${waitingSince(sql)}, e.id`;
  }
}

// Expects enquiry as `e` and person as `p`. Who may see what (the part_time
// narrowing, the restricted Finance team, team membership; access.ts) is
// here, in the WHERE clause, so it bounds the rows and the total alike and no
// filter can widen it (§6 "A").
export function whereSql(
  sql: postgres.Sql,
  q: EnquiryListQuery,
  viewer: Viewer,
) {
  const parts: Fragment[] = [
    sql`p.deleted_at IS NULL AND p.merged_into_id IS NULL`,
    enquiryAccessSql(sql, viewer, "read"),
  ];
  if (q.status === "active")
    parts.push(sql`e.status IN ('open', 'waiting_customer')`);
  else if (q.status !== "all") parts.push(sql`e.status = ${q.status}`);
  if (q.category) parts.push(sql`e.category = ${q.category}`);
  if (q.team) parts.push(sql`e.team_id = ${q.team}`);
  if (q.myTeams)
    parts.push(
      sql`e.team_id IN (SELECT team_id FROM team_member WHERE user_id = ${viewer.id})`,
    );
  if (q.channel) parts.push(sql`e.channel = ${q.channel}`);
  if (q.assignee === "unassigned") parts.push(sql`e.assigned_user_id IS NULL`);
  else if (q.assignee) parts.push(sql`e.assigned_user_id = ${q.assignee}`);
  if (q.mine) parts.push(sql`e.assigned_user_id = ${viewer.id}`);
  if (q.q) {
    // §9.1 search, as the enrolments list has it: name, email or any form of
    // the phone number finds the person.
    const parsed = parsePersonQuery(q.q);
    if (parsed) {
      const like = `%${likeEscape(parsed.text)}%`;
      parts.push(sql`(
        p.full_name ILIKE ${like}
        OR p.email_norm LIKE ${like.toLowerCase()}
        ${parsed.phoneE164 ? sql`OR p.phone_e164 = ${parsed.phoneE164}` : sql``}
        ${parsed.digits ? sql`OR regexp_replace(coalesce(p.phone_e164, '') || ' ' || coalesce(p.phone, ''), '\\D', '', 'g') LIKE ${`%${parsed.digits}%`}` : sql``}
      )`);
    }
  }
  return and(sql, parts);
}

// `now()` is the database's, never the browser's (§9.13 spec: the server
// decides "now"). Minutes come back fractional so the SLA compares exactly;
// the row reports whole minutes.
async function selectRows(
  sql: postgres.Sql,
  where: Fragment,
  tail: Fragment,
): Promise<EnquiryRow[]> {
  const [limit, rows] = await Promise.all([
    slaMinutes(sql),
    sql`SELECT e.id, e.version, e.number, e.subject, e.person_id, e.channel,
               e.category, c.label_en AS category_label, e.team_id,
               t.name AS team_name, e.priority, e.status,
               e.assigned_user_id, e.first_message_at, e.first_response_at,
               e.deal_id, e.sla_due_at,
               extract(epoch FROM coalesce(e.first_response_at, now()) - e.sla_due_at)
                 AS over_due_seconds,
               -- The phone stands in for a missing name (§11.2) and is not
               -- returned on its own: displayName() decides what leaves.
               p.full_name, p.phone,
               u.full_name AS assignee_name,
               extract(epoch FROM now() - ${waitingSince(sql)}) / 60
                 AS waited_minutes,
               extract(epoch FROM e.first_response_at - ${waitingSince(sql)}) / 60
                 AS response_minutes
        FROM enquiry e
        JOIN person p ON p.id = e.person_id
        JOIN team t ON t.id = e.team_id
        LEFT JOIN enquiry_category c ON c.code = e.category
        LEFT JOIN app_user u ON u.id = e.assigned_user_id
        WHERE ${where}
        ${tail}`,
  ]);
  return rows.map((r) => toEnquiryRow(r, limit));
}

// Exported for tests: the only shape that leaves this module, field by field,
// so a phone or email read for the name fallback can never ride along.
export function toEnquiryRow(
  r: postgres.Row,
  limit: number | null,
): EnquiryRow {
  const status = r.status as EnquiryStatus;
  const waited = Number(r.waited_minutes);
  const response =
    r.response_minutes == null ? null : Number(r.response_minutes);
  const overDue =
    r.over_due_seconds == null ? null : Number(r.over_due_seconds);
  return {
    id: r.id as string,
    number: r.number as string,
    subject: (r.subject as string | null) ?? null,
    version: Number(r.version),
    personId: r.person_id as string,
    personName: displayName(r.full_name as string, r.phone as string | null),
    channel: r.channel as string,
    category: (r.category as EnquiryCategory | null) ?? null,
    categoryLabel: (r.category_label as string | null) ?? null,
    teamId: r.team_id as string,
    teamName: r.team_name as string,
    priority: r.priority as EnquiryPriority,
    status,
    assignedUserId: (r.assigned_user_id as string | null) ?? null,
    assigneeName: (r.assignee_name as string | null) ?? null,
    firstMessageAt: r.first_message_at
      ? new Date(r.first_message_at as string).toISOString()
      : null,
    firstResponseAt: r.first_response_at
      ? new Date(r.first_response_at as string).toISOString()
      : null,
    waitedMinutes: Math.max(0, Math.floor(waited)),
    slaDueAt: r.sla_due_at
      ? new Date(r.sla_due_at as string).toISOString()
      : null,
    pastSla: isPastSla(
      {
        status,
        waitedMinutes: waited,
        responseMinutes: response,
        overDueSeconds: overDue,
      },
      limit,
    ),
    dealId: (r.deal_id as string | null) ?? null,
  };
}

// §6 enquiry row: F R - R E R A, widened by team membership and narrowed by
// restricted teams (access.ts). The route has checked mayUseEnquiries; a
// viewer with neither a role nor a team simply sees no rows.
export async function listEnquiries(
  q: EnquiryListQuery,
  viewer: Viewer,
): Promise<ListResponse<EnquiryRow>> {
  const sql = db();
  const where = whereSql(sql, q, viewer);
  const [[{ total }], data] = await Promise.all([
    sql`SELECT count(*)::int AS total
        FROM enquiry e JOIN person p ON p.id = e.person_id
        WHERE ${where}`,
    selectRows(
      sql,
      where,
      sql`ORDER BY ${orderSql(sql, q.sort)}
          LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    ),
  ]);
  return { data, page: { total, page: q.page, limit: q.limit } };
}

// One row in the queue's shape, for the PATCH answer: the screen replaces the
// row it has without reloading the whole queue. The caller has already
// checked the viewer may see it.
export async function enquiryRow(id: string): Promise<EnquiryRow | null> {
  const sql = db();
  const [row] = await selectRows(sql, sql`e.id = ${id}`, sql``);
  return row ?? null;
}
