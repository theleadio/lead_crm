import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import {
  canWriteClass,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import type { ListResponse } from "../people/types.ts";
import { db, withTransaction } from "../sql.ts";
import type { ClassCancel } from "../validation/class-cancel.ts";
import type { ClassListQuery } from "../validation/class-query.ts";
import type {
  ClassCreate,
  ClassNoticeChoice,
  ClassUpdate,
} from "../validation/class.ts";
import {
  hasNoticeWorthyChange,
  noticeWorthyChanges,
  upsertPendingNotice,
} from "./notices.ts";
import { seatTakenSql } from "./seats.ts";
import type { ClassListItem } from "./types.ts";

// Service layer for GET /api/classes (spec §7, §9.8). Read-only: nothing on
// the 9.8 list writes, so there is no If-Match and no audit row here.
// Classes fall under the §6 course/class row — every role reads.

// Spec §4: a Kuala Lumpur day, not the server's. Compared against end_date,
// not start_date, so a class that has started but not finished is still
// upcoming for Operations (design decision 3).
function whenSql(sql: postgres.Sql, when: ClassListQuery["when"]) {
  const today = sql`(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`;
  return when === "past"
    ? sql`c.end_date < ${today}`
    : sql`c.end_date >= ${today}`;
}

function filterSql(sql: postgres.Sql, q: ClassListQuery) {
  return sql`${whenSql(sql, q.when)}
    ${q.courseId ? sql`AND c.course_id = ${q.courseId}` : sql``}
    ${q.status ? sql`AND c.status = ${q.status}` : sql``}
    ${q.language ? sql`AND c.language = ${q.language}` : sql``}`;
}

// Spec §7 sort=: allow-list only, so sorting can never reach a column the
// list doesn't show. Ties break on id, so paging is stable. With no sort,
// upcoming reads soonest first and past reads most recent first (§9.8).
function orderSql(sql: postgres.Sql, q: ClassListQuery) {
  const sort = q.sort ?? (q.when === "past" ? "-start" : "start");
  const dir = sort.startsWith("-") ? sql`DESC` : sql`ASC`;
  switch (sort.replace("-", "")) {
    case "code":
      return sql`c.code ${dir}, c.id`;
    case "course":
      return sql`lower(co.name_en) ${dir}, c.start_date, c.id`;
    default:
      return sql`c.start_date ${dir}, c.code, c.id`;
  }
}

// Seats per §12.1, split into the two numbers §7 names. The expiry rule
// stays inside seatTakenSql, so an expired reservation is left out of both
// counts without this query knowing how that is decided.
function seatCountSql(sql: postgres.Sql, reserved: boolean) {
  return sql`(SELECT count(*)::int FROM enrolment e
    WHERE e.class_id = c.id AND ${seatTakenSql(sql)}
      ${reserved ? sql`AND e.status = 'reserved'` : sql`AND e.status <> 'reserved'`})`;
}

export async function listClasses(
  q: ClassListQuery,
  viewer: Viewer,
): Promise<ListResponse<ClassListItem>> {
  requirePermission(viewer, "class", "read");
  const sql = db();
  const where = filterSql(sql, q);

  const [[{ total }], rows] = await Promise.all([
    sql`SELECT count(*)::int AS total
        FROM class c JOIN course co ON co.id = c.course_id
        WHERE ${where}`,
    // Dates and times formatted by the database: a JS `Date` would drag the
    // server's timezone into a plain calendar date (§4).
    sql`SELECT c.id, c.code, c.course_id, co.name_en AS course_name,
               to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
               to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
               to_char(c.start_time, 'HH24:MI') AS start_time,
               to_char(c.end_time, 'HH24:MI') AS end_time,
               c.language, c.mode, c.venue_name, c.city, c.capacity,
               c.status, c.is_public, c.version,
               ${seatCountSql(sql, false)} AS confirmed_count,
               ${seatCountSql(sql, true)} AS reserved_count
        FROM class c JOIN course co ON co.id = c.course_id
        WHERE ${where}
        ORDER BY ${orderSql(sql, q)}
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
  ]);

  return {
    data: rows.map(toItem),
    page: { total, page: q.page, limit: q.limit },
  };
}

function toItem(r: Record<string, unknown>): ClassListItem {
  const capacity = r.capacity as number;
  const confirmedCount = r.confirmed_count as number;
  const reservedCount = r.reserved_count as number;
  return {
    id: r.id as string,
    code: r.code as string,
    courseId: r.course_id as string,
    courseName: r.course_name as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    startTime: r.start_time as string | null,
    endTime: r.end_time as string | null,
    language: r.language as ClassListItem["language"],
    mode: r.mode as ClassListItem["mode"],
    venueName: r.venue_name as string | null,
    city: r.city as string | null,
    capacity,
    confirmedCount,
    reservedCount,
    // An oversold class reports no seats left rather than a negative number
    // (§12.1, nothing here can oversell — 9.9 and 9.11 hold that lock).
    seatsAvailable: Math.max(0, capacity - confirmedCount - reservedCount),
    status: r.status as string,
    isPublic: r.is_public as boolean,
    // bigint comes back as a string from postgres.js.
    version: Number(r.version),
  };
}

// One class for the 9.9 edit form: every writable field plus `version` for
// the If-Match contract (§7). `online_url` is here, unlike on the list — the
// person editing the class is the one who sets it (§5 keeps it off the
// public feed, not off the form).
export type ClassRecord = ClassListItem & {
  venueAddress: string | null;
  onlineUrl: string | null;
  fewSeatsThreshold: number;
  priceMyr: string | null;
  hrdcClaimable: boolean;
};

export async function getClass(
  id: string,
  viewer: Viewer,
): Promise<ClassRecord | null> {
  requirePermission(viewer, "class", "read");
  if (!isUuid(id)) return null;
  const sql = db();
  const [r] = await sql`
    SELECT c.id, c.code, c.course_id, co.name_en AS course_name,
           to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
           to_char(c.start_time, 'HH24:MI') AS start_time,
           to_char(c.end_time, 'HH24:MI') AS end_time,
           c.language, c.mode, c.venue_name, c.venue_address, c.city,
           c.online_url, c.capacity, c.few_seats_threshold, c.price_myr,
           c.hrdc_claimable, c.status, c.is_public, c.version,
           ${seatCountSql(sql, false)} AS confirmed_count,
           ${seatCountSql(sql, true)} AS reserved_count
    FROM class c JOIN course co ON co.id = c.course_id
    WHERE c.id = ${id}`;
  if (!r) return null;
  return {
    ...toItem(r),
    venueAddress: r.venue_address as string | null,
    onlineUrl: r.online_url as string | null,
    fewSeatsThreshold: r.few_seats_threshold as number,
    priceMyr: r.price_myr as string | null,
    hrdcClaimable: r.hrdc_claimable as boolean,
  };
}

export type ClassWriteResult =
  | { kind: "ok"; id: string; version: number }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  // The code is taken (§5 unique): name the holder, so nobody makes a second
  // record for a class that already exists.
  | { kind: "duplicate"; code: string; holder: string }
  // §9.9: capacity may never drop under the seats already taken (§12.1).
  | { kind: "capacity_below_seats"; taken: number }
  // §7.1: the edit touches a notice field on a class with students and the
  // request carried no choice. Nothing was written.
  | { kind: "notice_required"; recipientCount: number }
  // A status move a person owns (cancelled, completed), or a field the §9.9
  // rules say must be filled in (§5 CHECK constraints).
  | { kind: "incomplete"; missing: string[] }
  // §12.1 (v1.9): Back to draft on a class people have already booked.
  | { kind: "class_has_seats"; taken: number }
  // §12.1 (v1.9): the website toggle on a class that is not open for booking.
  | { kind: "class_not_open" }
  // §9.10: the class is already called off. Cancelling again would send a
  // second round of notices for the same thing.
  | { kind: "already_cancelled" }
  // A cancel that went through, with how many enrolments it took with it
  // (§9.10: the toast and the audit row name the count).
  | { kind: "cancelled"; id: string; version: number; enrolmentCount: number };

// Columns the form writes, in the database's spelling. `status` and
// `is_public` are not here: a new class is a draft and publishing is its own
// action (design 7).
const COLUMNS: Record<string, string> = {
  courseId: "course_id",
  code: "code",
  startDate: "start_date",
  endDate: "end_date",
  startTime: "start_time",
  endTime: "end_time",
  language: "language",
  mode: "mode",
  venueName: "venue_name",
  venueAddress: "venue_address",
  city: "city",
  onlineUrl: "online_url",
  capacity: "capacity",
  fewSeatsThreshold: "few_seats_threshold",
  priceMyr: "price_myr",
  hrdcClaimable: "hrdc_claimable",
};

// Blank means "not set", not an empty string: §5 makes these columns
// nullable and the CHECK constraints test for NULL.
type ColumnValue = string | number | boolean | null;

const textOrNull = (v: unknown): ColumnValue =>
  typeof v === "string"
    ? v.trim() === ""
      ? null
      : v.trim()
    : ((v ?? null) as ColumnValue);

function toRow(input: Record<string, unknown>): Record<string, ColumnValue> {
  const row: Record<string, ColumnValue> = {};
  for (const [field, column] of Object.entries(COLUMNS))
    if (input[field] !== undefined) row[column] = textOrNull(input[field]);
  return row;
}

async function codeHolder(code: string, exceptId?: string) {
  const sql = db();
  const [row] = exceptId
    ? await sql`SELECT code FROM class WHERE code = ${code} AND id <> ${exceptId}`
    : await sql`SELECT code FROM class WHERE code = ${code}`;
  return row ? (row.code as string) : null;
}

// Seats taken for one class: the database's own function (migration 006),
// so the §9.9 capacity floor is judged by the same count that refuses an
// oversell. Read inside the transaction that holds the class row lock
// (design 4).
async function seatsTaken(classId: string): Promise<number> {
  const [row] = await db()`SELECT class_seats_taken(${classId}) AS taken`;
  return row.taken as number;
}

// §9.9 recipients: the people actually coming. A reservation or an unpaid
// seat is not a commitment, so those are not told (proposal open question 3).
const RECIPIENT_STATUSES = ["confirmed", "onboarded", "attended"];

async function recipientCount(classId: string): Promise<number> {
  const sql = db();
  const [row] = await sql`
    SELECT count(*)::int AS n FROM enrolment
    WHERE class_id = ${classId} AND status IN ${sql(RECIPIENT_STATUSES)}`;
  return row.n as number;
}

// The §9.9 conditional rules against a whole row, in database spelling.
// Returns a result only when something is wrong.
function classRuleIssues(
  row: Record<string, unknown>,
): ClassWriteResult | null {
  const missing: string[] = [];
  const blank = (v: unknown) =>
    v === null || v === undefined || String(v).trim() === "";
  if (row.mode !== "online") {
    if (blank(row.venue_name)) missing.push("venueName");
    if (blank(row.venue_address)) missing.push("venueAddress");
    if (blank(row.city)) missing.push("city");
  }
  if (row.mode !== "in_person" && blank(row.online_url))
    missing.push("onlineUrl");
  if (isoDate(row.end_date) < isoDate(row.start_date)) missing.push("endDate");
  return missing.length ? { kind: "incomplete", missing } : null;
}

// A `date` column comes back as a JS Date from `SELECT *`, and as the string
// the patch sent once merged. Both have to compare as plain days (§4).
function isoDate(value: unknown): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "");
}

// A `time` column reads back as "09:00:00" while the form sends "09:00".
// Compared raw, every save on a class that has times looked like a time
// change and asked for a notice decision nobody needed.
function hhmm(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, 5);
}

// The shape noticeWorthyChanges() compares, in camelCase (§9.9 fields).
function asNoticeShape(row: Record<string, unknown>) {
  return {
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    mode: row.mode ?? null,
    venueName: row.venue_name ?? null,
    venueAddress: row.venue_address ?? null,
    city: row.city ?? null,
    onlineUrl: row.online_url ?? null,
  };
}

// POST /api/classes — §9.9. A new class is always a draft and never public,
// whatever the request sends: publishing is a deliberate act (design 7).
export async function createClass(
  input: ClassCreate,
  viewer: Viewer,
): Promise<ClassWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  return withTransaction(async (): Promise<ClassWriteResult> => {
    const sql = db();
    const row: Record<string, ColumnValue> = {
      ...toRow(input as unknown as Record<string, unknown>),
      status: "draft",
      is_public: false,
      created_by: viewer.id,
    };
    // §5: hrdc_claimable defaults from the course when the form leaves it out.
    if (row.hrdc_claimable === null || row.hrdc_claimable === undefined) {
      const [course] =
        await sql`SELECT hrdc_claimable FROM course WHERE id = ${input.courseId}`;
      if (!course) return { kind: "not_found" };
      row.hrdc_claimable = course.hrdc_claimable;
    }

    // ON CONFLICT rather than catching 23505: an error would abort the
    // surrounding transaction, including the one a DB test wraps around it.
    const [created] = await sql`
      INSERT INTO class ${sql(row)}
      ON CONFLICT (code) DO NOTHING
      RETURNING id, version`;
    if (!created)
      return {
        kind: "duplicate",
        code: input.code,
        holder: (await codeHolder(input.code)) ?? input.code,
      };

    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "class",
      entityId: created.id,
      before: null,
      after: row,
    });
    return { kind: "ok", id: created.id, version: Number(created.version) };
  });
}

// PATCH /api/classes/:id — §9.9 and §7.1. One transaction: lock, version,
// duplicate, rules, capacity floor, notice decision, write, notice, audit
// (design 4). Every refusal returns before anything is written.
export async function updateClass(
  id: string,
  patch: ClassUpdate,
  ifMatch: number,
  choice: ClassNoticeChoice,
  viewer: Viewer,
): Promise<ClassWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<ClassWriteResult> => {
    const sql = db();
    const [before] = await sql`SELECT * FROM class WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    if (patch.code !== undefined) {
      const holder = await codeHolder(patch.code, id);
      if (holder) return { kind: "duplicate", code: patch.code, holder };
    }

    const set = toRow(patch as unknown as Record<string, unknown>);
    const columns = Object.keys(set);
    if (!columns.length)
      return { kind: "ok", id, version: Number(before.version) };

    // The merged row is what the conditional rules and the notice decision
    // are judged on, never the patch alone (design 3, 8).
    const merged = { ...before, ...set };
    const problems = classRuleIssues(merged);
    if (problems) return problems;

    if (merged.capacity !== before.capacity) {
      const taken = await seatsTaken(id);
      if ((merged.capacity as number) < taken)
        return { kind: "capacity_below_seats", taken };
    }

    const changes = noticeWorthyChanges(
      asNoticeShape(before),
      asNoticeShape(merged),
    );
    let recipients = 0;
    if (hasNoticeWorthyChange(changes)) {
      recipients = await recipientCount(id);
      // §7.1: the server decides whether a notice is needed, and nothing is
      // saved until the user has answered. Never the client's call.
      if (recipients > 0 && !choice)
        return { kind: "notice_required", recipientCount: recipients };
    }

    const [updated] = await sql`
      UPDATE class SET ${sql(set, columns)}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id, version`;
    // The row was read FOR UPDATE above, so it exists; no match means the
    // version moved under us.
    if (!updated) return { kind: "stale" };

    // §11.1 ClassChanged: raised by the edit, not by the notice. Save quietly
    // tells nobody, but the change still happened to students who are coming,
    // and an event Shawn's worker ignores costs less than one nobody raised.
    // `noticeId` is null when Ops chose to stay quiet. The spec row does not
    // spell the quiet path out — ask Shawn to confirm before he writes the
    // consumer; the spec is his to edit, not ours.
    const noticeId =
      choice === "prepare" && hasNoticeWorthyChange(changes)
        ? await upsertPendingNotice(
            id,
            merged.code as string,
            changes,
            recipients,
            viewer,
          )
        : null;
    if (recipients > 0)
      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
        VALUES ('ClassChanged', 'class', ${id},
                ${sql.json({ classId: id, changedFields: changes, noticeId })},
                ${viewer.id})`;

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class",
      entityId: id,
      before: Object.fromEntries(columns.map((c) => [c, before[c] ?? null])),
      after: set,
    });
    return { kind: "ok", id, version: Number(updated.version) };
  });
}

// Two controls, not one publish button (§12.1, §9.10, v1.9). Taking a class
// off the website and closing it for booking are different decisions: a
// corporate class takes enrolments while nobody outside sees it.
//
// ClassPublished is written by the database on any status or is_public change
// (migration 006, §11.1, §12.11), including the seat-driven ones no route
// sees. Neither function below raises it.

// POST /api/classes/:id/status — Open for booking / Back to draft. Writes
// `open` and nothing else; the database corrects that to few_seats or full in
// the same update from the seat count (006).
export async function setClassStatus(
  id: string,
  status: "open" | "draft",
  ifMatch: number,
  viewer: Viewer,
): Promise<ClassWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<ClassWriteResult> => {
    const sql = db();
    const [before] = await sql`SELECT * FROM class WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };
    // A cancelled or completed class is set by people and is not something to
    // open or push back to draft (§12.1) — Cancel class owns that move.
    if (before.status === "cancelled" || before.status === "completed")
      return { kind: "incomplete", missing: ["status"] };

    // §12.1: Back to draft is refused while anyone holds a seat, and it also
    // takes the class off the website — a class nobody may book is not one to
    // leave on the schedule feed.
    if (status === "draft") {
      const taken = await seatsTaken(id);
      if (taken > 0) return { kind: "class_has_seats", taken };
    }

    // No completeness check: §5's CHECK constraints already refuse to store a
    // class without a venue or link for its mode, with a capacity below one,
    // or with its dates reversed, so a stored class can always open.
    const [updated] = await sql`
      UPDATE class SET status = ${status}${status === "draft" ? sql`, is_public = false` : sql``}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id, version, status, is_public`;
    if (!updated) return { kind: "stale" };

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class",
      entityId: id,
      before: { status: before.status, is_public: before.is_public },
      // The stored values, not the asked-for ones: the database may have
      // corrected `open` to few_seats or full on the way in.
      after: { status: updated.status, is_public: updated.is_public },
    });
    return { kind: "ok", id, version: Number(updated.version) };
  });
}

// POST /api/classes/:id/website — Show on website / Hide from website. Writes
// `is_public` only. Hiding stops public registration (§8.3 needs is_public)
// and drops the class from the §8.1 feed; staff can still enrol people.
export async function setClassVisibility(
  id: string,
  isPublic: boolean,
  ifMatch: number,
  viewer: Viewer,
): Promise<ClassWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<ClassWriteResult> => {
    const sql = db();
    const [before] = await sql`SELECT * FROM class WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };
    // §12.1: offered only while the class takes bookings. A draft, cancelled
    // or completed class never reaches the website, so the toggle would be a
    // promise the feed doesn't keep.
    if (!["open", "few_seats", "full"].includes(before.status as string))
      return { kind: "class_not_open" };

    const [updated] = await sql`
      UPDATE class SET is_public = ${isPublic}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id, version`;
    if (!updated) return { kind: "stale" };

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class",
      entityId: id,
      before: { is_public: before.is_public },
      after: { is_public: isPublic },
    });
    return { kind: "ok", id, version: Number(updated.version) };
  });
}

// POST /api/classes/:id/cancel — §9.10, §7.1. One transaction under the class
// row lock: the class, every seat it was holding, the pending notice nobody
// will now need, the audit row and one ClassCancelled (§11.1). Refunds are
// not attempted here — they are super_admin's, in Stripe (§6).
export async function cancelClass(
  id: string,
  { reason }: ClassCancel,
  ifMatch: number,
  viewer: Viewer,
): Promise<ClassWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<ClassWriteResult> => {
    const sql = db();
    const [before] = await sql`SELECT * FROM class WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };
    if (before.status === "cancelled") return { kind: "already_cancelled" };

    const [updated] = await sql`
      UPDATE class SET status = 'cancelled'
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id, version`;
    if (!updated) return { kind: "stale" };

    // One statement, so the class is never cancelled while some of its
    // students still read as coming (design 5). Only the rows that were
    // holding a seat move: a cancelled, refunded, transferred, no-show or
    // completed enrolment is already history (§12.1). The 006 trigger exempts
    // a cancelled class, so freeing these seats cannot fail.
    // §11.1 EnrolmentCancelled, one per seat freed, written in the same
    // statement as the cancellation so neither can exist without the other.
    // Reason `class_cancelled` marks them: ClassCancelled below already tells
    // these students, so the worker must not notify twice. To confirm with
    // Shawn, who owns the spec.
    const cancelled = await sql`
      WITH freed AS (
        UPDATE enrolment e
        SET status = 'cancelled', cancelled_reason = 'class_cancelled'
        WHERE e.class_id = ${id} AND ${seatTakenSql(sql)}
        RETURNING e.id
      ), raised AS (
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                  created_by)
        SELECT 'EnrolmentCancelled', 'enrolment', freed.id,
               jsonb_build_object('enrolmentId', freed.id,
                                  'reason', 'class_cancelled'),
               ${viewer.id}
        FROM freed
      )
      SELECT id FROM freed`;
    const enrolmentIds = cancelled.map((r) => r.id as string);

    // A notice about a date nobody will now attend is not worth sending.
    await sql`
      UPDATE class_notice SET status = 'discarded'
      WHERE class_id = ${id} AND status = 'pending'`;

    // §11.1: and one event for the class itself, carrying every enrolment it
    // cancelled, so the worker can notify the students and flag the refunds
    // in one pass instead of one message per row.
    await sql`
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
      VALUES ('ClassCancelled', 'class', ${id},
              ${sql.json({ classId: id, reason, enrolmentIds })},
              ${viewer.id})`;

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class",
      entityId: id,
      before: { status: before.status },
      after: {
        status: "cancelled",
        reason,
        enrolments_cancelled: enrolmentIds.length,
      },
    });
    return {
      kind: "cancelled",
      id,
      version: Number(updated.version),
      enrolmentCount: enrolmentIds.length,
    };
  });
}
