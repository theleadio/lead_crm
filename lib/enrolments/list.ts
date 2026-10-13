import type postgres from "postgres";
import { requirePermission, type Viewer } from "../auth/permissions.ts";
import { classWhenSql, seatTakenSql } from "../classes/seats.ts";
import { likeEscape, parsePersonQuery } from "../people/search.ts";
import { displayName } from "../people/types.ts";
import type { ListResponse } from "../people/types.ts";
import { db } from "../sql.ts";
import type { EnrolmentListQuery } from "../validation/enrolment-query.ts";
import type { EnrolmentListItem } from "./types.ts";
import type { EnrolmentStatus } from "./status-rules.ts";

// GET /api/enrolments list half — the §9.11 list screen. Read-only: adding an
// enrolment is the §9.10 Roster's, changing one is the enrolment screen's.
// Seats and the upcoming/past cut come from `lib/classes/seats.ts`, so this
// screen and §9.8 can never disagree (§12.1, §12.11).

// Asia/Kuala_Lumpur is UTC+8 with no DST, as `lib/people/service.ts` has it.
const klStartOfDay = (d: string) => new Date(`${d}T00:00:00+08:00`);
const klEndOfDay = (d: string) => new Date(`${d}T23:59:59.999+08:00`);

type Fragment = postgres.PendingQuery<postgres.Row[]>;
const and = (sql: postgres.Sql, parts: Fragment[]) =>
  parts.reduce((acc, part) => sql`${acc} AND ${part}`);

// Spec §7 sort=, mapped to fixed fragments — never interpolated. Ties break on
// the enrolment id so paging is stable; no sort means newest enrolment first.
function orderSql(sql: postgres.Sql, sort: EnrolmentListQuery["sort"]) {
  const dir = sort?.startsWith("-") ? sql`DESC` : sql`ASC`;
  switch (sort?.replace("-", "")) {
    case "person":
      return sql`lower(coalesce(p.full_name, '')) ${dir}, e.id`;
    case "class":
      return sql`c.code ${dir}, e.id`;
    case "status":
      return sql`e.status ${dir}, e.id`;
    case "enrolled":
      return sql`e.created_at ${dir}, e.id`;
    default:
      return sql`e.created_at DESC, e.id`;
  }
}

function whereSql(sql: postgres.Sql, q: EnrolmentListQuery) {
  const parts: Fragment[] = [classWhenSql(sql, q.when)];

  if (q.q) {
    // §9.1: typing "012-345 6789", "+60123456789" or part of a number finds
    // the same person. The enrolled person only — the booker is shown on the
    // §9.11 screen, not searched here.
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
  if (q.classId) parts.push(sql`e.class_id = ${q.classId}`);
  if (q.courseId) parts.push(sql`c.course_id = ${q.courseId}`);
  if (q.status) parts.push(sql`e.status = ${q.status}`);
  if (q.payerType) parts.push(sql`e.payer_type = ${q.payerType}`);
  // §5, not §6: whether the enrolment stores a price, never whether a payment
  // arrived — a `payment` join would hand support different rows (design 2).
  if (q.hasPrice !== undefined)
    parts.push(
      q.hasPrice
        ? sql`e.price_paid_myr IS NOT NULL`
        : sql`e.price_paid_myr IS NULL`,
    );
  if (q.enrolledFrom)
    parts.push(sql`e.created_at >= ${klStartOfDay(q.enrolledFrom)}`);
  if (q.enrolledTo)
    parts.push(sql`e.created_at <= ${klEndOfDay(q.enrolledTo)}`);

  return and(sql, parts);
}

// §6 enrolment row: super_admin, management, sales, support and operations
// read, with no owner limit — marketing and part_time have no access at all.
export async function listEnrolments(
  q: EnrolmentListQuery,
  viewer: Viewer,
): Promise<ListResponse<EnrolmentListItem>> {
  requirePermission(viewer, "enrolment", "read");
  const sql = db();
  const where = whereSql(sql, q);

  const [[{ total }], rows] = await Promise.all([
    sql`SELECT count(*)::int AS total
        FROM enrolment e
        JOIN person p ON p.id = e.person_id
        JOIN class c ON c.id = e.class_id
        WHERE ${where}`,
    // Dates formatted by the database: a JS `Date` would drag the server's
    // timezone into a plain calendar date (§4).
    sql`SELECT e.id, e.person_id, e.class_id, e.status, e.payer_type,
               e.price_paid_myr, e.created_at,
               -- The phone is read to stand in for a missing name (§11.2);
               -- displayName() below decides what leaves here.
               p.full_name, p.phone,
               c.code AS class_code, co.name_en AS course_name,
               to_char(c.start_date, 'YYYY-MM-DD') AS class_start_date,
               to_char(c.end_date, 'YYYY-MM-DD') AS class_end_date,
               ${seatTakenSql(sql)} AS holds_seat
        FROM enrolment e
        JOIN person p ON p.id = e.person_id
        JOIN class c ON c.id = e.class_id
        JOIN course co ON co.id = c.course_id
        WHERE ${where}
        ORDER BY ${orderSql(sql, q.sort)}
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id as string,
      personId: r.person_id as string,
      personName: displayName(r.full_name as string, r.phone as string | null),
      classId: r.class_id as string,
      classCode: r.class_code as string,
      courseName: r.course_name as string,
      classStartDate: r.class_start_date as string,
      classEndDate: r.class_end_date as string,
      status: r.status as EnrolmentStatus,
      holdsSeat: r.holds_seat as boolean,
      payerType: r.payer_type as string,
      // §4: money as a decimal string, never a float. §12.7: the snapshot.
      pricePaidMyr: r.price_paid_myr === null ? null : String(r.price_paid_myr),
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    page: { total, page: q.page, limit: q.limit },
  };
}
