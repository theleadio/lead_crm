import { writeAudit } from "../audit.ts";
import { permissionFor, type Viewer } from "../auth/permissions.ts";
import { SEAT_STATUSES } from "../classes/seats.ts";
import { canChangeTo } from "../enrolments/status-rules.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { proofKeyBelongsTo, readObject, signRead } from "../uploads/signer.ts";
import { verifyProof, type ProofCheck } from "../uploads/verify.ts";
import type { PaymentManualBody } from "../validation/payment.ts";
import type { RecordedPayment } from "./types.ts";

// Service layer for §9.12 Record manual payment (`POST /api/payments/manual`,
// §7). The only way the app writes a `payment` row (§4 rule 4), so the §6
// permission, the §14 file check, the §12.4 status move and the §11.1 events
// are all decided here.
//
// Deliberately absent: any arithmetic over an enrolment's payments. §9.12
// describes confirming only once succeeded payments reach `price_paid_myr` and
// says it is not built until Finance answers O16; when it is, it goes in the
// database, because the Stripe webhook must obey it too (§3). So nothing here
// sums `amount_myr` or reads `price_paid_myr` (design 4).

// §9.12: money cannot be recorded against an enrolment in one of these.
const BLOCKED_STATUSES = ["cancelled", "refunded", "transferred"];

// §12.1, as in `lib/enrolments/service.ts`: a cancelled or completed class is
// exempt from the seat guard, so history can still be corrected. The 006
// trigger exempts the same two.
const SEAT_GUARD_EXEMPT = ["cancelled", "completed"];

function holdsSeat(status: string): boolean {
  return SEAT_STATUSES.includes(status);
}

export type PaymentWriteResult =
  | { kind: "ok"; payment: RecordedPayment }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  // §9.12: the enrolment is cancelled, refunded or transferred.
  | { kind: "blocked_status"; status: string }
  // §12.1: confirming would oversell. The database has the last word.
  | { kind: "no_seats"; classCode: string }
  // Migration 008 `payment_proof_key_uq`: this proof is already on a payment,
  // so this is a double-click or a retry, not new money (§9.12).
  | { kind: "already_recorded" }
  // design 2: the key was issued for a different enrolment.
  | { kind: "proof_not_yours" }
  | { kind: "proof_missing" }
  // §14: the stored bytes are not an accepted type, or are too big.
  | { kind: "proof_rejected"; check: Exclude<ProofCheck, { ok: true }> };

// Migration 008 raises this on a second payment carrying the same proof file.
// Caught rather than pre-checked with a SELECT, so two saves racing on one key
// cannot both pass (design 7) — the same shape as `isDuplicate` in
// `lib/enrolments/service.ts`.
function isDuplicateProof(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string };
  return err.code === "23505" && err.constraint_name === "payment_proof_key_uq";
}

// Migration 006 raises `no_seats` (SQLSTATE P0001) on a write that oversells a
// published class — for this route, confirming an enrolment whose reservation
// had already run out.
function isNoSeats(e: unknown): boolean {
  return Boolean((e as { message?: string }).message?.includes("no_seats"));
}

async function seatsTaken(classId: string): Promise<number> {
  const [row] = await db()`SELECT class_seats_taken(${classId}) AS taken`;
  return row.taken as number;
}

async function classCodeOf(enrolmentId: string): Promise<string> {
  const [row] = await db()`
    SELECT c.code FROM enrolment e JOIN class c ON c.id = e.class_id
    WHERE e.id = ${enrolmentId}`;
  return (row?.code as string) ?? "";
}

// §6 payment row: operations has `E` and super_admin `F`, so those two record
// a payment. Management and sales may read money but not add it; support,
// marketing and part_time have no payment access at all. Refunds are nobody's
// here — they happen in Stripe (§6 footnote 3).
export function canRecordPayment(viewer: Viewer): boolean {
  return permissionFor(viewer, "payment", "write").allowed;
}

// `GET /api/payments/:id/proof` — §9.12, §14. The proof is never a URL in a
// rendered page: it is minted per click, expires shortly after, and the read
// is audited like every other sight of a payment record (§6).
export type ProofReadResult =
  { kind: "ok"; url: string } | { kind: "forbidden" } | { kind: "not_found" };

export async function readPaymentProof(
  paymentId: string,
  viewer: Viewer,
): Promise<ProofReadResult> {
  if (!permissionFor(viewer, "payment", "read").allowed)
    return { kind: "forbidden" };
  if (!isUuid(paymentId)) return { kind: "not_found" };

  const sql = db();
  // The deal a payment belongs to, directly or through its enrolment — the
  // same reach §12.5 uses for won-with-money, so the §6 sales rule is judged
  // on the same link.
  const [payment] = await sql`
    SELECT p.proof_file_key, coalesce(d.owner_user_id, ed.owner_user_id) AS owner_user_id
    FROM payment p
    LEFT JOIN deal d ON d.id = p.deal_id
    LEFT JOIN enrolment e ON e.id = p.enrolment_id
    LEFT JOIN deal ed ON ed.id = e.deal_id
    WHERE p.id = ${paymentId}`;
  if (!payment || !payment.proof_file_key) return { kind: "not_found" };

  // §6 footnote 2: sales read money only on deals they own. A payment with no
  // deal behind it has no owner to check, so it stays out of their reach.
  if (viewer.role === "sales" && payment.owner_user_id !== viewer.id)
    return { kind: "forbidden" };

  // §6: every sight of a payment record is audit-logged.
  await writeAudit({
    userId: viewer.id,
    action: "view",
    entity: "payment",
    entityId: paymentId,
    before: null,
    after: { proof: true },
  });

  return { kind: "ok", url: await signRead(payment.proof_file_key as string) };
}

// `POST /api/payments/manual` — §9.12. The file is verified before the
// transaction opens (design 3), then one transaction under the enrolment and
// class row locks writes the payment, the status move §12.4 allows, the §11.1
// events and the audit rows together.
export async function recordManualPayment(
  body: PaymentManualBody,
  ifMatch: number,
  viewer: Viewer,
  // The one seam in this file: the stored bytes come from the object store in
  // the app, and from a fixture in the database tests, which have a database
  // but no bucket. Everything the §14 check then decides is the real code.
  readProofBytes: (key: string) => Promise<Uint8Array | null> = readObject,
): Promise<PaymentWriteResult> {
  if (!canRecordPayment(viewer)) return { kind: "forbidden" };
  if (!isUuid(body.enrolmentId)) return { kind: "not_found" };

  // design 2: a key issued for one enrolment cannot be attached to another.
  if (!proofKeyBelongsTo(body.proofKey, body.enrolmentId))
    return { kind: "proof_not_yours" };

  // §14: judge the object that is actually stored, not the name or the
  // content type the browser declared.
  const bytes = await readProofBytes(body.proofKey);
  if (!bytes) return { kind: "proof_missing" };
  const check = verifyProof(bytes);
  if (!check.ok) return { kind: "proof_rejected", check };

  try {
    return await withTransaction(async (): Promise<PaymentWriteResult> => {
      const sql = db();
      const [enrolment] = await sql`
        SELECT e.*, p.preferred_language AS person_language
        FROM enrolment e JOIN person p ON p.id = e.person_id
        WHERE e.id = ${body.enrolmentId} FOR UPDATE OF e`;
      if (!enrolment) return { kind: "not_found" };
      if (Number(enrolment.version) !== ifMatch) return { kind: "stale" };

      const from = enrolment.status as string;
      if (BLOCKED_STATUSES.includes(from))
        return { kind: "blocked_status", status: from };

      // §12.4 decides, through the same table the status control reads: true
      // for `reserved` and `payment_pending`, false for everything else. A
      // late payment on a confirmed or onboarded student is recorded with the
      // status left alone (§9.12 Status).
      const statusMoved = canChangeTo(from, "confirmed");

      const [cls] = await sql`
        SELECT id, code, status, capacity FROM class
        WHERE id = ${enrolment.class_id} FOR UPDATE`;
      // §12.1: only a move that starts holding a seat claims one. Both
      // statuses that move to confirmed already hold theirs, so this guards
      // the case where the reservation had run out — and the 006 trigger,
      // caught below, has the last word on it.
      if (
        statusMoved &&
        !holdsSeat(from) &&
        !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
        (await seatsTaken(cls.id as string)) >= (cls.capacity as number)
      )
        return { kind: "no_seats", classCode: cls.code as string };

      // §5: the payment names the enrolment, and the enrolment's deal when it
      // has one, so §6's "sales see payments on their own deals" and §12.5's
      // won-with-money rule both see this row (design 10). `status` is
      // succeeded because §9.12 records a payment only once the money has
      // arrived; `paid_at` is the date entered, read as that calendar day.
      const [payment] = await sql`
        INSERT INTO payment (enrolment_id, deal_id, match_status, method,
                             status, amount_myr, reference_no, proof_file_key,
                             paid_at, notes, recorded_by, created_by)
        VALUES (${body.enrolmentId}, ${enrolment.deal_id}, 'matched',
                ${body.method}, 'succeeded', ${body.amountMyr},
                ${body.referenceNo}, ${body.proofKey},
                ${new Date(`${body.paidOn}T00:00:00Z`)},
                ${body.notes ?? null}, ${viewer.id}, ${viewer.id})
        RETURNING id`;

      // The enrolment is written either way: the status when §12.4 allows it,
      // and otherwise `updated_at` alone, so the 005 trigger bumps `version`
      // and an open screen learns it is behind (design 6). `updated_at` is not
      // one of the columns the 006 seat trigger watches, so a late payment
      // does no seat work.
      const [updated] = statusMoved
        ? await sql`
            UPDATE enrolment SET status = 'confirmed'
            WHERE id = ${body.enrolmentId} AND version = ${ifMatch}
            RETURNING version`
        : await sql`
            UPDATE enrolment SET updated_at = now()
            WHERE id = ${body.enrolmentId} AND version = ${ifMatch}
            RETURNING version`;
      if (!updated) return { kind: "stale" };

      // §11.1: exact names, and in the same transaction as the money.
      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                  created_by)
        VALUES ('PaymentRecorded', 'payment', ${payment.id},
                ${sql.json({
                  paymentId: payment.id as string,
                  enrolmentId: body.enrolmentId,
                  method: body.method,
                  amountMyr: body.amountMyr,
                })},
                ${viewer.id})`;
      if (statusMoved)
        await sql`
          INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                                    created_by)
          VALUES ('EnrolmentConfirmed', 'enrolment', ${body.enrolmentId},
                  ${sql.json({
                    enrolmentId: body.enrolmentId,
                    personId: enrolment.person_id as string,
                    classId: enrolment.class_id as string,
                    language: enrolment.person_language as string,
                  })},
                  ${viewer.id})`;

      await writeAudit({
        userId: viewer.id,
        action: "create",
        entity: "payment",
        entityId: payment.id as string,
        before: null,
        after: {
          enrolment_id: body.enrolmentId,
          method: body.method,
          amount_myr: body.amountMyr,
          reference_no: body.referenceNo,
          paid_at: body.paidOn,
        },
      });
      if (statusMoved)
        await writeAudit({
          userId: viewer.id,
          action: "update",
          entity: "enrolment",
          entityId: body.enrolmentId,
          before: { status: from },
          after: { status: "confirmed", payment_id: payment.id },
        });

      return {
        kind: "ok",
        payment: {
          paymentId: payment.id as string,
          enrolmentId: body.enrolmentId,
          method: body.method,
          amountMyr: body.amountMyr,
          version: Number(updated.version),
          statusMoved,
          status: statusMoved ? "confirmed" : from,
        },
      };
    });
  } catch (e) {
    if (isDuplicateProof(e)) return { kind: "already_recorded" };
    if (isNoSeats(e))
      return {
        kind: "no_seats",
        classCode: await classCodeOf(body.enrolmentId),
      };
    throw e;
  }
}
