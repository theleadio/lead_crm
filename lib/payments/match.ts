import { writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";
import {
  SEAT_GUARD_EXEMPT,
  insertConfirmedSeat,
  isNoSeats,
  liveEnrolmentId,
  seatsTaken,
} from "../enrolments/service.ts";
import { canChangeTo } from "../enrolments/status-rules.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { PaymentMatchBody } from "../validation/payment.ts";
import { canRecordPayment } from "./service.ts";

// §11.3 payment match (`POST /api/payments/:id/match`, §7.1). The Stripe
// webhook (lead_sales) stores a payment it can't tie to a live seat as
// `unmatched` and gives Ops a `match_payment` task. Ops pick the person and
// the class here, and one transaction gives the student a confirmed seat,
// links the money, closes the task and raises the §11.1 events.
//
// Shawn, 18 Nov 2026: a person who already waits on a live seat in that class
// gets that seat confirmed, not a second one; the new seat carries the class
// price (the money stays on the payment row); a payment refunded in full is
// not matched (its task is withdrawn by the webhook's charge.refunded).

export type PaymentMatch = {
  paymentId: string;
  enrolmentId: string;
  classCode: string;
  seatCreated: boolean;
  status: string;
};

export type PaymentMatchResult =
  | { kind: "ok"; match: PaymentMatch }
  | { kind: "forbidden" }
  // The payment, the person (or deleted / merged away) or the class.
  | { kind: "not_found" }
  // A second click, or another user got there first.
  | { kind: "already_matched" }
  // Not an unmatched Stripe payment that has the money.
  | { kind: "not_unmatched" }
  // Refunded in full in Stripe: nothing left to match.
  | { kind: "refunded" }
  // Money for a cancelled class is a refund, not a seat.
  | { kind: "class_cancelled"; classCode: string }
  // §12.1: a new confirmed seat would oversell.
  | { kind: "no_seats"; classCode: string }
  // §12.4: the person's seat in that class can't become confirmed.
  | { kind: "blocked_status"; status: string };

// A seat at or past confirmed takes the money with its status left alone, as
// a late manual payment does (§9.12 Status). `reserved` and `payment_pending`
// move to confirmed (§12.4); any other live status is refused.
const KEEPS_STATUS = ["confirmed", "onboarded", "attended", "completed"];

export async function matchPayment(
  paymentId: string,
  body: PaymentMatchBody,
  viewer: Viewer,
): Promise<PaymentMatchResult> {
  if (!canRecordPayment(viewer)) return { kind: "forbidden" };
  if (!isUuid(paymentId)) return { kind: "not_found" };
  try {
    return await withTransaction(async (): Promise<PaymentMatchResult> => {
      const sql = db();
      // The payment row first: a second match waits here, then reads matched.
      const [payment] = await sql`
        SELECT id, match_status, method, status, amount_myr FROM payment
        WHERE id = ${paymentId} FOR UPDATE`;
      if (!payment) return { kind: "not_found" };
      // A manual payment was matched when it was recorded (§9.12).
      if (!["stripe_card", "stripe_fpx"].includes(payment.method))
        return { kind: "not_unmatched" };
      if (payment.match_status === "matched")
        return { kind: "already_matched" };
      if (payment.status === "refunded") return { kind: "refunded" };
      if (!["succeeded", "partially_refunded"].includes(payment.status))
        return { kind: "not_unmatched" };

      const [person] = await sql`
        SELECT id, preferred_language FROM person
        WHERE id = ${body.personId} AND deleted_at IS NULL
          AND merged_into_id IS NULL`;
      if (!person) return { kind: "not_found" };

      // Lock order as a manual payment and a transfer take it: the seat, then
      // the class. Read again under the class lock, which a new seat needs.
      const lockSeat = async (id: string | null) =>
        id
          ? (
              await sql`
                SELECT id, status, deal_id FROM enrolment
                WHERE id = ${id} FOR UPDATE`
            )[0]
          : undefined;
      let seat = await lockSeat(
        await liveEnrolmentId(body.personId, body.classId),
      );
      const [cls] = await sql`
        SELECT id, code, status, capacity FROM class
        WHERE id = ${body.classId} FOR UPDATE`;
      if (!cls) return { kind: "not_found" };
      const classCode = cls.code as string;
      if (cls.status === "cancelled")
        return { kind: "class_cancelled", classCode };
      const live = await liveEnrolmentId(body.personId, body.classId);
      if (live !== ((seat?.id as string | undefined) ?? null))
        seat = await lockSeat(live);

      let enrolmentId: string;
      let from: string | null = null;
      let statusMoved: boolean;
      if (seat) {
        from = seat.status as string;
        statusMoved = canChangeTo(from, "confirmed");
        if (!statusMoved && !KEEPS_STATUS.includes(from))
          return { kind: "blocked_status", status: from };
        enrolmentId = seat.id as string;
        // Both statuses that move hold their seat already; a reservation whose
        // hold ran out is caught by the 006 trigger (no_seats, below).
        // Otherwise `updated_at` alone, so an open screen learns it is behind.
        if (statusMoved)
          await sql`UPDATE enrolment SET status = 'confirmed' WHERE id = ${enrolmentId}`;
        else
          await sql`UPDATE enrolment SET updated_at = now() WHERE id = ${enrolmentId}`;
      } else {
        if (
          !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
          (await seatsTaken(cls.id as string)) >= (cls.capacity as number)
        )
          return { kind: "no_seats", classCode };
        enrolmentId = await insertConfirmedSeat(
          body.personId,
          body.classId,
          viewer.id,
        );
        statusMoved = true;
      }

      // §5: the payment names the seat, and the seat's deal when it has one,
      // as a manual payment does.
      const dealId = (seat?.deal_id as string | null | undefined) ?? null;
      await sql`
        UPDATE payment
        SET enrolment_id = ${enrolmentId}, deal_id = coalesce(deal_id, ${dealId}),
            match_status = 'matched', updated_at = now()
        WHERE id = ${paymentId}`;

      // None is fine: a task closed some other way must not hold up the money.
      const closed = await sql`
        UPDATE task SET done_at = now(), done_by = ${viewer.id}
        WHERE payment_id = ${paymentId} AND type = 'match_payment'
          AND done_at IS NULL
        RETURNING id`;

      // §11.1: exact names and payloads, in the same transaction.
      const event = (
        type: string,
        aggregateType: string,
        aggregateId: string,
        payload: Record<string, string>,
      ) => sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                  created_by)
        VALUES (${type}, ${aggregateType}, ${aggregateId}, ${sql.json(payload)},
                ${viewer.id})`;
      if (!seat)
        await event("EnrolmentCreated", "enrolment", enrolmentId, {
          enrolmentId,
          personId: body.personId,
          classId: body.classId,
          status: "confirmed",
        });
      await event("PaymentRecorded", "payment", paymentId, {
        paymentId,
        enrolmentId,
        method: payment.method as string,
        amountMyr: String(payment.amount_myr),
      });
      if (statusMoved)
        await event("EnrolmentConfirmed", "enrolment", enrolmentId, {
          enrolmentId,
          personId: body.personId,
          classId: body.classId,
          language: person.preferred_language as string,
        });

      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "payment",
        entityId: paymentId,
        before: { match_status: "unmatched", enrolment_id: null },
        after: { match_status: "matched", enrolment_id: enrolmentId },
      });
      await writeAudit({
        userId: viewer.id,
        action: seat ? "update" : "create",
        entity: "enrolment",
        entityId: enrolmentId,
        before: seat ? { status: from } : null,
        after: seat
          ? { status: statusMoved ? "confirmed" : from, payment_id: paymentId }
          : {
              person_id: body.personId,
              class_id: body.classId,
              status: "confirmed",
              payment_id: paymentId,
            },
      });
      // Tasks-screen rule: the audit row carries no free text.
      for (const t of closed)
        await writeAudit({
          userId: viewer.id,
          action: "update",
          entity: "task",
          entityId: t.id as string,
          before: { done_at: null },
          after: { done: true, closed: "payment matched", paymentId },
        });

      return {
        kind: "ok",
        match: {
          paymentId,
          enrolmentId,
          classCode,
          seatCreated: !seat,
          status: statusMoved ? "confirmed" : (from as string),
        },
      };
    });
  } catch (e) {
    if (isNoSeats(e)) {
      const [cls] =
        await db()`SELECT code FROM class WHERE id = ${body.classId}`;
      return { kind: "no_seats", classCode: (cls?.code as string) ?? "" };
    }
    throw e;
  }
}

// What the match screen shows (§11.3): the payment as Stripe sent it, the
// notes of its match_payment task as the webhook wrote them, and, once
// matched, the seat and who matched it when.
export type PaymentForMatch = {
  id: string;
  amountMyr: string;
  refundedMyr: string;
  method: string;
  status: string;
  paidAt: string | null;
  checkoutSessionId: string | null;
  matchStatus: string;
  taskNotes: string | null;
  matched: {
    enrolmentId: string;
    personId: string;
    personName: string;
    classId: string;
    classCode: string;
    by: string | null;
    at: string | null;
  } | null;
};

export async function getPaymentForMatch(
  id: string,
  viewer: Viewer,
): Promise<PaymentForMatch | null> {
  if (!canRecordPayment(viewer) || !isUuid(id)) return null;
  const sql = db();
  const [p] = await sql`
    SELECT p.id, p.amount_myr::text AS amount, p.refunded_amount_myr::text AS refunded,
           p.method, p.status, p.paid_at, p.stripe_checkout_session_id,
           p.match_status, p.enrolment_id, e.person_id, per.full_name,
           e.class_id, c.code AS class_code
    FROM payment p
    LEFT JOIN enrolment e ON e.id = p.enrolment_id
    LEFT JOIN person per ON per.id = e.person_id
    LEFT JOIN class c ON c.id = e.class_id
    WHERE p.id = ${id}`;
  if (!p) return null;
  // The open task, else the one the match closed.
  const [t] = await sql`
    SELECT t.notes, t.done_at, u.full_name AS done_by
    FROM task t LEFT JOIN app_user u ON u.id = t.done_by
    WHERE t.payment_id = ${id} AND t.type = 'match_payment'
    ORDER BY t.done_at DESC NULLS FIRST, t.created_at DESC
    LIMIT 1`;
  // §6: every sight of a payment record is audit-logged.
  await writeAudit({
    userId: viewer.id,
    action: "view",
    entity: "payment",
    entityId: id,
    before: null,
    after: { screen: "match" },
  });
  return {
    id,
    amountMyr: p.amount as string,
    refundedMyr: p.refunded as string,
    method: p.method as string,
    status: p.status as string,
    paidAt: p.paid_at ? new Date(p.paid_at as string).toISOString() : null,
    checkoutSessionId: (p.stripe_checkout_session_id as string | null) ?? null,
    matchStatus: p.match_status as string,
    taskNotes: (t?.notes as string | null) ?? null,
    matched:
      p.match_status === "matched" && p.enrolment_id
        ? {
            enrolmentId: p.enrolment_id as string,
            personId: p.person_id as string,
            personName: p.full_name as string,
            classId: p.class_id as string,
            classCode: p.class_code as string,
            by: (t?.done_by as string | null) ?? null,
            at: t?.done_at ? new Date(t.done_at as string).toISOString() : null,
          }
        : null,
  };
}
