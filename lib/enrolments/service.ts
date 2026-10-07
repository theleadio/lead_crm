import { writeAudit } from "../audit.ts";
import {
  canWriteEnrolment,
  permissionFor,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { SEAT_STATUSES, seatCountSql } from "../classes/seats.ts";
import { isUuid } from "../people/service.ts";
import { displayName } from "../people/types.ts";
import { db, withTransaction } from "../sql.ts";
import type {
  EnrolmentCreate,
  EnrolmentStatusBody,
  EnrolmentTransferBody,
} from "../validation/enrolment.ts";
import type { EnrolmentDetail, EnrolmentPaymentRow } from "./types.ts";
import {
  canChangeTo,
  canTransfer,
  statusMoves,
  type EnrolmentStatus,
} from "./status-rules.ts";

// Service layer for §9.11 Enrolment detail (§7.1 GET /api/enrolments/:id).
// Every enrolment write in the app comes through this file, so §12.4 and the
// §12.1 seat rule are decided once (design 1). Seats and class status stay the
// database's: nothing here writes a `class` row (§12.1, §12.11).

// §6 enrolment row: super_admin, management, sales, support and operations
// read. Marketing and part_time have no access at all, so this throws and the
// route turns it into an audited 403.
export async function getEnrolment(
  id: string,
  viewer: Viewer,
): Promise<EnrolmentDetail | null> {
  requirePermission(viewer, "enrolment", "read");
  if (!isUuid(id)) return null;
  const sql = db();
  const [r] = await sql`
    SELECT e.id, e.version, e.status, e.payer_type, e.person_id, e.deal_id,
           e.booker_person_id, e.price_paid_myr, e.onboarding_step,
           e.certificate_no, e.seat_reserved_until, e.cancelled_reason,
           e.completed_at, e.transferred_to_enrolment_id, e.created_at,
           -- Phones are read only to stand in for a missing name (§11.2);
           -- displayName() below decides what leaves this function.
           p.full_name, p.phone,
           b.full_name AS booker_full_name, b.phone AS booker_phone,
           c.id AS class_id, c.code AS class_code, c.course_id,
           c.capacity, c.status AS class_status,
           to_char(c.start_date, 'YYYY-MM-DD') AS class_start_date,
           to_char(c.end_date, 'YYYY-MM-DD') AS class_end_date,
           co.name_en AS course_name,
           tc.code AS transferred_to_class_code,
           ${seatCountSql(sql, false)} AS confirmed_count,
           ${seatCountSql(sql, true)} AS reserved_count
    FROM enrolment e
    JOIN person p ON p.id = e.person_id
    JOIN class c ON c.id = e.class_id
    JOIN course co ON co.id = c.course_id
    LEFT JOIN person b ON b.id = e.booker_person_id
    LEFT JOIN enrolment te ON te.id = e.transferred_to_enrolment_id
    LEFT JOIN class tc ON tc.id = te.class_id
    WHERE e.id = ${id}`;
  if (!r) return null;

  const capacity = r.capacity as number;
  const confirmedCount = r.confirmed_count as number;
  const reservedCount = r.reserved_count as number;
  return {
    id: r.id as string,
    // bigint comes back as a string from postgres.js.
    version: Number(r.version),
    status: r.status as EnrolmentStatus,
    payerType: r.payer_type as string,
    personId: r.person_id as string,
    personName: displayName(r.full_name as string, r.phone as string | null),
    bookerPersonId: r.booker_person_id as string | null,
    bookerName:
      r.booker_person_id === null
        ? null
        : displayName(
            r.booker_full_name as string | null,
            r.booker_phone as string | null,
          ),
    dealId: r.deal_id as string | null,
    classId: r.class_id as string,
    classCode: r.class_code as string,
    courseName: r.course_name as string,
    classStartDate: r.class_start_date as string,
    classEndDate: r.class_end_date as string,
    classCourseId: r.course_id as string,
    classStatus: r.class_status as string,
    capacity,
    confirmedCount,
    reservedCount,
    // An oversold class reports no seats left rather than a negative number,
    // as the §9.8 list does (§12.1).
    seatsAvailable: Math.max(0, capacity - confirmedCount - reservedCount),
    // §12.7: the snapshot taken at purchase, as a decimal string (§4). Never
    // the class's current price.
    pricePaidMyr: r.price_paid_myr === null ? null : String(r.price_paid_myr),
    onboardingStep: r.onboarding_step as number,
    certificateNo: r.certificate_no as string | null,
    seatReservedUntil: iso(r.seat_reserved_until),
    cancelledReason: r.cancelled_reason as string | null,
    completedAt: iso(r.completed_at),
    transferredToEnrolmentId: r.transferred_to_enrolment_id as string | null,
    transferredToClassCode: r.transferred_to_class_code as string | null,
    createdAt: iso(r.created_at) as string,
    // §6 payment row: null where the viewer may not read payments at all, so
    // no access and an empty list read differently on screen.
    payments: await readPayments(id, r.deal_id as string | null, viewer),
  };
}

// The payments recorded against this enrolment (§5 `payment`). Narrower than
// the §9.2 read, which reaches a person's payments through their deals too;
// the §6 sales rule is the same line in both, and the test below is what keeps
// them from drifting (design 9).
async function readPayments(
  enrolmentId: string,
  dealId: string | null,
  viewer: Viewer,
): Promise<EnrolmentPaymentRow[] | null> {
  if (!permissionFor(viewer, "payment", "read").allowed) return null;
  const sql = db();
  // §6 ²: sales reads money only on deals they own. An enrolment with no deal
  // has no owner to check, so it stays out of their reach.
  if (viewer.role === "sales") {
    const [owned] = dealId
      ? await sql`
          SELECT 1 FROM deal
          WHERE id = ${dealId} AND owner_user_id = ${viewer.id}`
      : [];
    if (!owned) return [];
  }
  const rows = await sql`
    SELECT id, method, amount_myr, status, paid_at
    FROM payment WHERE enrolment_id = ${enrolmentId}
    ORDER BY created_at DESC`;
  const payments = rows.map((x) => ({
    id: x.id as string,
    method: x.method as string,
    // §4: money as a decimal string, never a float.
    amountMyr: String(x.amount_myr),
    status: x.status as string,
    paidAt: iso(x.paid_at),
  }));
  // §6: every view of a payment record is audit-logged, as §9.2 does.
  for (const payment of payments)
    await writeAudit({
      userId: viewer.id,
      action: "view",
      entity: "payment",
      entityId: payment.id,
      before: null,
      after: null,
    });
  return payments;
}

function iso(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value as string).toISOString();
}

// Every §9.11 write ends in one of these, turned into a §7 status code by
// `enrolmentWriteResponse`, so the four routes cannot word the same refusal
// differently (design 8).
export type EnrolmentWriteResult =
  | { kind: "ok"; id: string; version: number }
  | { kind: "created"; id: string; version: number }
  | {
      kind: "transferred";
      id: string;
      version: number;
      newEnrolmentId: string;
      toClassCode: string;
    }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  // §12.4: the move is not on the diagram. `allowed` is what is, so the
  // message can say where this enrolment may go instead.
  | { kind: "illegal_transition"; from: string; to: string; allowed: string[] }
  // §12.1: the class is full. The database has the last word (migration 006);
  // this is the friendly version of its refusal.
  | { kind: "no_seats"; classCode: string }
  // §5 unique index: the person already holds a live enrolment in that class.
  | { kind: "duplicate"; classCode: string; enrolmentId: string | null }
  // §12.4: transfer is offered on a confirmed enrolment only.
  | { kind: "not_transferable"; status: string }
  | { kind: "same_class" };

// §12.1: which statuses occupy a seat. A reservation whose hold has run out is
// one of these by status but holds nothing, so moving it on is a fresh claim —
// which is why the count below comes from the database, not from this list.
function holdsSeat(status: string): boolean {
  return SEAT_STATUSES.includes(status);
}

// §12.1: a cancelled or completed class is exempt from the seat guard, so
// history can be imported and corrected. The 006 trigger exempts the same two.
const SEAT_GUARD_EXEMPT = ["cancelled", "completed"];

// The database's own count (migration 006), read under the class row lock, so
// the friendly message is judged by the number that refuses an oversell.
async function seatsTaken(classId: string): Promise<number> {
  const [row] = await db()`SELECT class_seats_taken(${classId}) AS taken`;
  return row.taken as number;
}

// Migration 006 raises `no_seats` (SQLSTATE P0001) on any write that oversells
// a published class. Caught outside the transaction, as `merge-service.ts`
// catches `merge_blocked:`, and answered with the same 409 as the friendly
// check (design 3).
function isNoSeats(e: unknown): boolean {
  return Boolean((e as { message?: string }).message?.includes("no_seats"));
}

// §5 `enrolment_person_class_active_uq`: one live enrolment per person per
// class. A partial unique index, so ON CONFLICT cannot name it without
// repeating its predicate — the violation is caught instead (design 5).
function isDuplicate(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string };
  return (
    err.code === "23505" &&
    err.constraint_name === "enrolment_person_class_active_uq"
  );
}

async function liveEnrolmentId(
  personId: string,
  classId: string,
): Promise<string | null> {
  const [row] = await db()`
    SELECT id FROM enrolment
    WHERE person_id = ${personId} AND class_id = ${classId}
      AND status NOT IN ('cancelled', 'refunded', 'transferred')`;
  return (row?.id as string) ?? null;
}

async function classCode(classId: string): Promise<string> {
  const [row] = await db()`SELECT code FROM class WHERE id = ${classId}`;
  return (row?.code as string) ?? "";
}

// POST /api/enrolments/:id/status — §9.11, §12.4, §7.1. One transaction under
// the enrolment and class row locks: the status, the audit row and the §11.1
// event move together. Nothing here writes a `class` row — seats and class
// status are the database's (§12.1, §12.11).
export async function changeEnrolmentStatus(
  id: string,
  { toStatus, reason }: EnrolmentStatusBody,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnrolmentWriteResult> {
  if (!canWriteEnrolment(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  try {
    return await withTransaction(async (): Promise<EnrolmentWriteResult> => {
      const sql = db();
      const [before] = await sql`
        SELECT e.*, p.preferred_language AS person_language
        FROM enrolment e JOIN person p ON p.id = e.person_id
        WHERE e.id = ${id} FOR UPDATE OF e`;
      if (!before) return { kind: "not_found" };
      if (Number(before.version) !== ifMatch) return { kind: "stale" };

      const from = before.status as string;
      // §12.4 decides, not the screen: the same table the control read.
      if (!canChangeTo(from, toStatus))
        return {
          kind: "illegal_transition",
          from,
          to: toStatus,
          allowed: statusMoves(from),
        };

      const [cls] = await sql`
        SELECT id, code, status, capacity FROM class
        WHERE id = ${before.class_id} FOR UPDATE`;
      // A move that starts holding a seat claims one; moving between two
      // seat-holding statuses (confirmed → onboarded) never does (§12.1).
      if (
        holdsSeat(toStatus) &&
        !holdsSeat(from) &&
        !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
        (await seatsTaken(cls.id as string)) >= (cls.capacity as number)
      )
        return { kind: "no_seats", classCode: cls.code as string };

      const [updated] = await sql`
        UPDATE enrolment SET
          status = ${toStatus},
          cancelled_reason = ${
            toStatus === "cancelled"
              ? (reason ?? null)
              : (before.cancelled_reason as string | null)
          },
          -- §5 refuses a completed row with no date, so it is set here rather
          -- than left to whoever moves the status.
          completed_at = ${
            toStatus === "completed"
              ? new Date()
              : (before.completed_at as Date | null)
          }
        WHERE id = ${id} AND version = ${ifMatch}
        RETURNING id, version`;
      if (!updated) return { kind: "stale" };

      // §11.1: only these two moves raise an event, and each goes to the
      // outbox in the same transaction as the status it describes.
      if (toStatus === "confirmed")
        await sql`
          INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                    created_by)
          VALUES ('EnrolmentConfirmed', 'enrolment', ${id},
                  ${sql.json({
                    enrolmentId: id,
                    personId: before.person_id as string,
                    classId: before.class_id as string,
                    language: before.person_language as string,
                  })},
                  ${viewer.id})`;
      if (toStatus === "cancelled")
        await sql`
          INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                    created_by)
          VALUES ('EnrolmentCancelled', 'enrolment', ${id},
                  ${sql.json({ enrolmentId: id, reason: reason ?? null })},
                  ${viewer.id})`;

      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "enrolment",
        entityId: id,
        before: { status: from },
        after: { status: toStatus, ...(reason ? { reason } : {}) },
      });
      return { kind: "ok", id, version: Number(updated.version) };
    });
  } catch (e) {
    // The trigger had the last word: same 409 as the check above (design 3).
    if (isNoSeats(e)) {
      const [row] = await db()`
        SELECT c.code FROM enrolment e JOIN class c ON c.id = e.class_id
        WHERE e.id = ${id}`;
      return { kind: "no_seats", classCode: (row?.code as string) ?? "" };
    }
    throw e;
  }
}

// POST /api/enrolments — §9.11, §7.1. The Add control on the §9.10 Roster. One
// transaction under the class row lock: the seat check, the insert and one
// EnrolmentCreated (§11.1). The price comes from the class on the server —
// nothing in the body can set an amount (§8.3, §12.7) — and a reservation's
// hold is left to the database to fill (§12.1, migration 007).
export async function createEnrolment(
  body: EnrolmentCreate,
  viewer: Viewer,
): Promise<EnrolmentWriteResult> {
  if (!canWriteEnrolment(viewer)) return { kind: "forbidden" };
  try {
    return await withTransaction(async (): Promise<EnrolmentWriteResult> => {
      const sql = db();
      const [cls] = await sql`
        SELECT id, code, status, capacity, price_myr FROM class
        WHERE id = ${body.classId} FOR UPDATE`;
      if (!cls) return { kind: "not_found" };
      const [person] = await sql`
        SELECT id FROM person
        WHERE id = ${body.personId} AND deleted_at IS NULL
          AND merged_into_id IS NULL`;
      if (!person) return { kind: "not_found" };

      if (
        !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
        (await seatsTaken(body.classId)) >= (cls.capacity as number)
      )
        return { kind: "no_seats", classCode: cls.code as string };

      // §5: one live enrolment per person per class, checked under the lock so
      // the message can name the enrolment that already exists (design 5).
      const existing = await liveEnrolmentId(body.personId, body.classId);
      if (existing)
        return {
          kind: "duplicate",
          classCode: cls.code as string,
          enrolmentId: existing,
        };

      const [created] = await sql`
        INSERT INTO enrolment (person_id, class_id, booker_person_id, status,
                               payer_type, price_paid_myr, created_by)
        VALUES (${body.personId}, ${body.classId},
                ${body.bookerPersonId ?? null}, ${body.status},
                ${body.payerType}, ${cls.price_myr}, ${viewer.id})
        RETURNING id, version`;

      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                  created_by)
        VALUES ('EnrolmentCreated', 'enrolment', ${created.id},
                ${sql.json({
                  enrolmentId: created.id as string,
                  personId: body.personId,
                  classId: body.classId,
                  status: body.status,
                })},
                ${viewer.id})`;

      await writeAudit({
        userId: viewer.id,
        action: "create",
        entity: "enrolment",
        entityId: created.id as string,
        before: null,
        after: {
          person_id: body.personId,
          class_id: body.classId,
          status: body.status,
          payer_type: body.payerType,
        },
      });
      return {
        kind: "created",
        id: created.id as string,
        version: Number(created.version),
      };
    });
  } catch (e) {
    if (isNoSeats(e))
      return { kind: "no_seats", classCode: await classCode(body.classId) };
    if (isDuplicate(e))
      return {
        kind: "duplicate",
        classCode: await classCode(body.classId),
        enrolmentId: await liveEnrolmentId(body.personId, body.classId),
      };
    throw e;
  }
}

// POST /api/enrolments/:id/transfer — §9.11, §7.1, §12.4. One transaction: the
// new enrolment on the target class, the source row marked `transferred` and
// pointed at it, the audit row and one EnrolmentTransferred (§11.1). Payments
// stay where they were recorded (design 4, proposal open question 1), and the
// price moves as the §12.7 snapshot rather than being read again.
export async function transferEnrolment(
  id: string,
  { toClassId }: EnrolmentTransferBody,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnrolmentWriteResult> {
  if (!canWriteEnrolment(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  try {
    return await withTransaction(async (): Promise<EnrolmentWriteResult> => {
      const sql = db();
      // Lock order: the source enrolment, then the target class. Fixed, so two
      // transfers crossing between the same classes cannot deadlock (design 4).
      const [before] = await sql`
        SELECT * FROM enrolment WHERE id = ${id} FOR UPDATE`;
      if (!before) return { kind: "not_found" };
      if (Number(before.version) !== ifMatch) return { kind: "stale" };
      if (!canTransfer(before.status as string))
        return { kind: "not_transferable", status: before.status as string };
      if (before.class_id === toClassId) return { kind: "same_class" };

      const [target] = await sql`
        SELECT id, code, status, capacity FROM class WHERE id = ${toClassId}
        FOR UPDATE`;
      if (!target) return { kind: "not_found" };
      if (
        !SEAT_GUARD_EXEMPT.includes(target.status as string) &&
        (await seatsTaken(toClassId)) >= (target.capacity as number)
      )
        return { kind: "no_seats", classCode: target.code as string };

      // §5: one live enrolment per person per class. Checked here, under the
      // target's row lock, rather than left to the unique index: a violation
      // aborts the transaction, which costs the friendly message its queries.
      // The index still guards the race — the catch below answers that.
      const existing = await liveEnrolmentId(
        before.person_id as string,
        toClassId,
      );
      if (existing)
        return {
          kind: "duplicate",
          classCode: target.code as string,
          enrolmentId: existing,
        };

      const [created] = await sql`
        INSERT INTO enrolment (person_id, class_id, deal_id, booker_person_id,
                               status, payer_type, price_paid_myr, created_by)
        VALUES (${before.person_id}, ${toClassId}, ${before.deal_id},
                ${before.booker_person_id}, 'confirmed', ${before.payer_type},
                ${before.price_paid_myr}, ${viewer.id})
        RETURNING id`;

      // §5 CHECK: a `transferred` row must name where it went, so both land in
      // the one statement.
      const [updated] = await sql`
        UPDATE enrolment
        SET status = 'transferred', transferred_to_enrolment_id = ${created.id}
        WHERE id = ${id} AND version = ${ifMatch}
        RETURNING id, version`;
      if (!updated) return { kind: "stale" };

      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                  created_by)
        VALUES ('EnrolmentTransferred', 'enrolment', ${id},
                ${sql.json({
                  enrolmentId: id,
                  fromClassId: before.class_id as string,
                  toClassId,
                  newEnrolmentId: created.id as string,
                })},
                ${viewer.id})`;

      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "enrolment",
        entityId: id,
        before: { status: before.status, class_id: before.class_id },
        after: {
          status: "transferred",
          class_id: toClassId,
          transferred_to_enrolment_id: created.id,
        },
      });
      return {
        kind: "transferred",
        id,
        version: Number(updated.version),
        newEnrolmentId: created.id as string,
        toClassCode: target.code as string,
      };
    });
  } catch (e) {
    if (isNoSeats(e))
      return { kind: "no_seats", classCode: await classCode(toClassId) };
    // §5: the person already holds a live enrolment in the target class.
    if (isDuplicate(e)) {
      const [row] = await db()`
        SELECT person_id FROM enrolment WHERE id = ${id}`;
      return {
        kind: "duplicate",
        classCode: await classCode(toClassId),
        enrolmentId: row
          ? await liveEnrolmentId(row.person_id as string, toClassId)
          : null,
      };
    }
    throw e;
  }
}
