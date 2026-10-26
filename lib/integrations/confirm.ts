import { raiseEvent } from "../events/raise.ts";
import { canChangeTo } from "../enrolments/status-rules.ts";
import { db } from "../sql.ts";

// §9.12 / O16 part-payment rule for money that arrives without a person at a
// keyboard (the Stripe webhook): an enrolment moves to `confirmed` only when
// its succeeded payments total at least the price. Below that it is parked in
// `payment_pending` (a seat-holding status that does not expire) so a part
// payment never loses the seat. The manual-payment service does not call this
// yet (it confirms on any payment, `lib/payments/service.ts`); spec §9.12 puts
// the rule in the database once Finance answers O16, and this function is the
// one place to move then. Caller holds the enrolment row lock.

export type PaidState = {
  priceMyr: string | null; // price_paid_myr, else class price, else list price
  paidMyr: string; // succeeded payments so far
  balanceMyr: string | null; // price - paid, never below zero
};

export async function paidState(enrolmentId: string): Promise<PaidState> {
  const [r] = await db()`
    SELECT x.price,
           x.paid,
           CASE WHEN x.price IS NULL THEN NULL
                ELSE greatest(x.price - x.paid, 0) END AS balance
    FROM (
      SELECT coalesce(e.price_paid_myr, c.price_myr, co.list_price_myr) AS price,
             (SELECT coalesce(sum(p.amount_myr), 0) FROM payment p
              WHERE p.enrolment_id = e.id AND p.status = 'succeeded') AS paid
      FROM enrolment e
      JOIN class c ON c.id = e.class_id
      JOIN course co ON co.id = c.course_id
      WHERE e.id = ${enrolmentId}) x`;
  return {
    priceMyr: r.price === null ? null : String(r.price),
    paidMyr: String(r.paid),
    balanceMyr: r.balance === null ? null : String(r.balance),
  };
}

// Applies the rule after a succeeded payment row exists. Returns the status
// the enrolment ends in. Statuses that cannot move (confirmed, onboarded...)
// are left alone, as §9.12 says of a late payment.
export async function confirmWhenPaid(
  enrolmentId: string,
): Promise<{ from: string; to: string }> {
  const sql = db();
  const [e] = await sql`
    SELECT e.status, e.person_id, e.class_id, p.preferred_language AS language
    FROM enrolment e JOIN person p ON p.id = e.person_id
    WHERE e.id = ${enrolmentId}`;
  const from = e.status as string;
  const s = await paidState(enrolmentId);
  const full = s.balanceMyr !== null && Number(s.balanceMyr) === 0;
  if (full && canChangeTo(from, "confirmed")) {
    await sql`UPDATE enrolment SET status = 'confirmed' WHERE id = ${enrolmentId}`;
    await raiseEvent(
      "EnrolmentConfirmed",
      enrolmentId,
      {
        enrolmentId,
        personId: e.person_id as string,
        classId: e.class_id as string,
        language: e.language as string,
      },
      null,
    );
    return { from, to: "confirmed" };
  }
  if (!full && from === "reserved") {
    await sql`UPDATE enrolment SET status = 'payment_pending' WHERE id = ${enrolmentId}`;
    return { from, to: "payment_pending" };
  }
  return { from, to: from };
}
