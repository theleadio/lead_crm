import { writeAudit } from "../audit.ts";
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "../events/drain.ts";
import { raiseEvent } from "../events/raise.ts";
import { dutySuperAdmin } from "../people/duplicate-review.ts";
import { isUuid } from "../people/service.ts";
import { confirmWhenPaid, paidState } from "./confirm.ts";
import { db, withTransaction } from "../sql.ts";
import type { ReducedEvent, ReducedSession } from "./stripe-reduce.ts";

// Spec §3, §11.3: Stripe events are staged in integration_event first, then
// handled from there, inline once and by `npm run integrations:process` for
// any that failed. Every handler is safe to run twice.

const SOURCE = "stripe";
const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
]);

// Stores the reduced event. Returns the row id to process, or null when there
// is nothing to do: this event id was already stored (a replay), or the type
// is one we do not act on, which is stored as 'ignored' so it is visible and
// never retried (refunds and charges are O53).
export async function stageStripeEvent(
  event: ReducedEvent,
): Promise<string | null> {
  const ignored = !HANDLED.has(event.type);
  const sql = db();
  const [row] = await sql`
    INSERT INTO integration_event (source, external_event_id, payload, status,
                                   processed_at)
    VALUES (${SOURCE}, ${event.id}, ${sql.json(event as never)},
            ${ignored ? "ignored" : "received"},
            ${ignored ? sql`now()` : null})
    ON CONFLICT (source, external_event_id) DO NOTHING
    RETURNING id`;
  return row && !ignored ? (row.id as string) : null;
}

export type StripeRunResult = {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
};

// Claims due received/failed rows one at a time (SKIP LOCKED, so two runners
// never share one), each in its OWN transaction: its locks are held only while
// that row runs, and a row that cannot even record its outcome rolls back
// alone, never the rows already done. The handler itself runs in a savepoint,
// and the outcome is marked after. A failure backs off like the outbox (30 s,
// 2 min, 10 min, 1 h); the failure that reaches MAX_ATTEMPTS leaves the row
// 'failed' with attempts at the cap, which the claim query skips: that is the
// dead letter (integration_event has no dead_at), and it opens an Ops task.
// `ids` limits the claim to given rows (the inline call).
export async function processStripeEvents(
  opts: { batch?: number; ids?: string[] } = {},
): Promise<StripeRunResult> {
  const batch = opts.batch ?? 20;
  const ids = opts.ids ?? null;
  const out: StripeRunResult = { claimed: 0, processed: 0, failed: 0, dead: 0 };
  for (let i = 0; i < batch; i++) {
    const outcome = await withTransaction(async () => {
      const sql = db();
      const [r] = await sql`
        SELECT id, payload, attempts FROM integration_event
        WHERE source = ${SOURCE} AND status IN ('received', 'failed')
          AND attempts < ${MAX_ATTEMPTS} AND next_attempt_at <= now()
          AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
        ORDER BY next_attempt_at, received_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (!r) return null;
      const event = r.payload as ReducedEvent;
      try {
        const keep = await withTransaction(() => handleStripeEvent(event));
        // O35: customer name and email stay only where Ops need them, on an
        // unmatched payment. Everywhere else they are blanked once handled.
        await sql`
          UPDATE integration_event
          SET status = 'processed', processed_at = now(),
              attempts = attempts + 1, error = NULL,
              payload = CASE WHEN ${keep} OR payload->'session' IS NULL
                             THEN payload
                             ELSE jsonb_set(payload, '{session,customer_details}', 'null') END
          WHERE id = ${r.id}`;
        return "processed" as const;
      } catch (err) {
        const n = (r.attempts as number) + 1;
        const wait = BACKOFF_SECONDS[Math.min(n, BACKOFF_SECONDS.length) - 1];
        await sql`
          UPDATE integration_event
          SET status = 'failed', attempts = ${n}, error = ${describe(err)},
              next_attempt_at = now() + make_interval(secs => ${wait})
          WHERE id = ${r.id}`;
        // A payment the system will never record by itself: say so to Ops now,
        // not after five retries (and not never, as with no payment row).
        if (err instanceof NeedsOps)
          await attentionTask(r.id, event, `${err.message}`, "attention");
        if (n >= MAX_ATTEMPTS) {
          await attentionTask(
            r.id,
            event,
            `gave up after ${n} attempts: ${describe(err)}`,
            "dead",
          );
          return "dead" as const;
        }
        return "failed" as const;
      }
    });
    if (!outcome) break;
    out.claimed++;
    if (outcome === "processed") out.processed++;
    else {
      out.failed++;
      if (outcome === "dead") out.dead++;
    }
  }
  return out;
}

// A failure that needs a person and cannot be fixed by retrying.
export class NeedsOps extends Error {}

// One Ops task per event and kind (source_key), assigned to the duty
// super_admin (O37). Carries what Ops need to find the money in Stripe: the
// event id, the amount and currency, what failed. No customer details.
async function attentionTask(
  rowId: string,
  event: ReducedEvent,
  what: string,
  kind: "attention" | "dead",
): Promise<void> {
  const s = event.session;
  const notes = [
    `What failed: ${what}`,
    `Stripe event ${event.id} (${event.type}), session ${s?.id ?? "none in the stored payload"}`,
    `Amount: ${s?.amount_total == null ? "unknown" : (s.amount_total / 100).toFixed(2)} ${(s?.currency ?? "unknown").toUpperCase()}`,
    "No payment was recorded. Check the payment in Stripe and record it by hand.",
  ].join("\n");
  await db()`
    INSERT INTO task (type, title, assigned_user_id, due_at, notes, source_key)
    VALUES ('other',
            ${kind === "dead" ? "Stripe event failed for good: check the payment" : "Stripe payment not recorded: check by hand"},
            ${await dutySuperAdmin()}, now(), ${notes},
            ${`stripe:${rowId}:${kind}`})
    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
}

// Error text kept in `error`: a database error is reduced to its code, so no
// row values travel with it.
function describe(err: unknown): string {
  const e = err as { code?: string; constraint_name?: string };
  if (typeof e.code === "string")
    return `db:${e.code}${e.constraint_name ? `:${e.constraint_name}` : ""}`;
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

// Returns true when the stored payload must keep the customer's name and email
// (an unmatched payment, where Ops need them).
export async function handleStripeEvent(event: ReducedEvent): Promise<boolean> {
  const s = event.session;
  if (!s) {
    if (HANDLED.has(event.type) && event.type !== "checkout.session.expired")
      throw new NeedsOps("event has no session object");
    throw new Error(`${event.type} event has no session object`);
  }
  if (event.type === "checkout.session.expired") {
    await onExpired(s);
    return false;
  }
  // Delayed methods complete unpaid and settle later; only 'paid' is money.
  if (s.payment_status !== "paid") return false;
  return onPaid(event, s);
}

// ---- checkout.session.expired ----------------------------------------------

// A reservation whose Checkout link ran out and which is still unpaid is
// cancelled, as expire_reservations() does for a hold that ran out, with its
// own reason. The session must be the one on the enrolment's deal: an older
// link expiring after a newer one was sent changes nothing.
async function onExpired(s: ReducedSession): Promise<void> {
  const id = s.metadata.enrolment_id;
  if (!isUuid(id)) return;
  const sql = db();
  const [e] = await sql`
    SELECT e.id, e.status FROM enrolment e
    JOIN deal d ON d.id = e.deal_id
    WHERE e.id = ${id} AND d.checkout_session_id = ${s.id}
    FOR UPDATE OF e`;
  if (!e || e.status !== "reserved") return;
  await sql`
    UPDATE enrolment
    SET status = 'cancelled', cancelled_reason = 'checkout_expired'
    WHERE id = ${id}`;
  await raiseEvent(
    "EnrolmentCancelled",
    id,
    { enrolmentId: id, reason: "checkout_expired" },
    null,
  );
  await writeAudit({
    userId: null,
    action: "update",
    entity: "enrolment",
    entityId: id,
    before: { status: "reserved" },
    after: { status: "cancelled", cancelled_reason: "checkout_expired" },
  });
}

// ---- checkout.session.completed (paid) -------------------------------------

type Matched = {
  ok: true;
  enrolmentId: string;
  dealId: string | null;
  priceMyr: string; // the price the match used, snapshotted on the enrolment
};
type Unmatched = { ok: false; reason: string; enrolmentId: string | null };

// Decides whether a paid session belongs to an enrolment we can still honour.
// Locks the enrolment row so a concurrent cancel or second payment waits.
async function decide(
  s: ReducedSession,
  amount: string,
): Promise<Matched | Unmatched> {
  const sql = db();
  const eid = s.metadata.enrolment_id;
  if (!isUuid(eid))
    return { ok: false, reason: "no_metadata", enrolmentId: null };
  const [e] = await sql`
    SELECT e.id, e.status, e.class_id, e.deal_id, c.status AS class_status,
           d.checkout_session_id AS deal_session
    FROM enrolment e JOIN class c ON c.id = e.class_id
    LEFT JOIN deal d ON d.id = e.deal_id
    WHERE e.id = ${eid} FOR UPDATE OF e`;
  if (!e) return { ok: false, reason: "unknown_enrolment", enrolmentId: null };
  const no = (reason: string): Unmatched => ({
    ok: false,
    reason,
    enrolmentId: eid,
  });
  if (s.metadata.class_id !== e.class_id) return no("class_mismatch");
  if ((s.metadata.deal_id ?? null) !== (e.deal_id ?? null))
    return no("deal_mismatch");
  // The paying session must be the one on the deal. A superseded link that was
  // still paid goes to Ops (O54).
  if (e.deal_id && e.deal_session !== s.id) return no("session_mismatch");
  if (["cancelled", "completed"].includes(e.class_status as string))
    return no("class_" + e.class_status);
  // reserved/payment_pending move to confirmed; confirmed/onboarded keep their
  // status (a late balance, §9.12). Anything else, cancelled above all, is a
  // payment after expiry (§12.1).
  if (
    !["reserved", "payment_pending", "confirmed", "onboarded"].includes(
      e.status as string,
    )
  )
    return no("enrolment_" + e.status);
  // The session charges the class price (§8.3), or the balance of a part
  // payment. Anything else, including a second full payment on an enrolment
  // that is already paid up, is for Ops to look at (O54).
  const st = await paidState(eid);
  if (st.balanceMyr === null) return no("no_price");
  if (Number(st.balanceMyr) === 0) return no("already_paid");
  if (Number(st.balanceMyr) !== Number(amount)) return no("amount_mismatch");
  return {
    ok: true,
    enrolmentId: eid,
    dealId: e.deal_id as string | null,
    priceMyr: st.priceMyr as string,
  };
}

// Returns true when an unmatched payment was recorded (keep the customer data).
async function onPaid(
  event: ReducedEvent,
  s: ReducedSession,
): Promise<boolean> {
  if (s.amount_total === null || s.amount_total <= 0) return false; // nothing charged
  // The payment table is MYR only. A foreign-currency charge is not guessed
  // at: the row fails, retries, dead-letters, shows in integration health, and
  // opens an Ops task at once (NeedsOps).
  if (s.currency !== "myr") throw new NeedsOps("unsupported currency");
  const amount = (s.amount_total / 100).toFixed(2);
  // Known gap (O61): FPX counts only when it is the sole method. A session
  // offering card and FPX is always recorded as stripe_card, whichever the
  // customer used; the exact method needs the payment intent, which this
  // reduced payload does not carry. Checkout is not changed for this.
  const method =
    s.payment_method_types.length === 1 && s.payment_method_types[0] === "fpx"
      ? "stripe_fpx"
      : "stripe_card";
  const paidAt = new Date(
    (event.created || Math.floor(Date.now() / 1000)) * 1000,
  );

  const insert = async (m: Matched | Unmatched) => {
    const [p] = await db()`
      INSERT INTO payment (enrolment_id, deal_id, match_status, method, status,
                           amount_myr, stripe_payment_intent_id,
                           stripe_checkout_session_id, paid_at)
      VALUES (${m.ok ? m.enrolmentId : null}, ${m.ok ? m.dealId : null},
              ${m.ok ? "matched" : "unmatched"}, ${method}, 'succeeded',
              ${amount}, ${s.payment_intent}, ${s.id}, ${paidAt})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    return (p?.id as string | undefined) ?? null; // null: already recorded
  };

  // Two events for one payment (completed, then async_payment_succeeded) queue
  // here; the second finds the first's row and stops.
  await db()`SELECT pg_advisory_xact_lock(hashtextextended(${"stripe:" + s.id}, 0))`;
  const known = await db()`
    SELECT 1 FROM payment
    WHERE stripe_checkout_session_id = ${s.id}
       OR (${s.payment_intent}::text IS NOT NULL
           AND stripe_payment_intent_id = ${s.payment_intent})`;
  if (known.length) return false;

  let m = await decide(s, amount);
  if (m.ok) {
    const matched = m;
    try {
      // Own savepoint: if confirming fails (the hold had run out and the class
      // filled up), the payment row rolls back with it and the money goes the
      // unmatched way below.
      await withTransaction(async () => {
        const id = await insert(matched);
        if (!id) return;
        // §12: price_paid_myr is a snapshot at purchase. A later change to the
        // class price must not change what this student owes.
        await db()`
          UPDATE enrolment
          SET price_paid_myr = coalesce(price_paid_myr, ${matched.priceMyr})
          WHERE id = ${matched.enrolmentId}`;
        const r = await confirmWhenPaid(matched.enrolmentId);
        await writeAudit({
          userId: null,
          action: "create",
          entity: "payment",
          entityId: id,
          before: null,
          after: {
            enrolment_id: matched.enrolmentId,
            method,
            amount_myr: amount,
            stripe_event: event.id,
            status_from: r.from,
            status_to: r.to,
          },
        });
      });
      return false;
    } catch (err) {
      // Migration 006/007: RAISE EXCEPTION 'no_seats...' is SQLSTATE P0001.
      const e = err as { code?: string; message?: string };
      if (e.code !== "P0001" && !String(e.message).includes("no_seats"))
        throw err;
      m = { ok: false, reason: "no_seats", enrolmentId: matched.enrolmentId };
    }
  }
  const unmatched = m as Unmatched;
  const id = await insert(unmatched);
  if (id) await matchPaymentTask(id, event, s, amount, unmatched);
  return true;
}

// §11.3: one open match_payment task per unmatched payment, for the duty
// super_admin (O37). Money is never dropped: the payment row exists, the task
// holds what Ops need to place it. No personal data in the title; the notes
// carry the customer's email and name, because Ops need them to place an
// unmatched payment (an O35 gap). This task exists only for unmatched money.
async function matchPaymentTask(
  paymentId: string,
  event: ReducedEvent,
  s: ReducedSession,
  amount: string,
  m: Unmatched,
): Promise<void> {
  const sql = db();
  const [e] = m.enrolmentId
    ? await sql`SELECT id, person_id FROM enrolment WHERE id = ${m.enrolmentId}`
    : [];
  const notes = [
    `Why: ${m.reason}`,
    `Amount: RM${amount}, paid ${new Date(event.created * 1000).toISOString()}`,
    `Stripe event ${event.id}, session ${s.id}, payment intent ${s.payment_intent ?? "none"}`,
    // Only the three ids, never the whole metadata object.
    `Ids in the metadata: deal ${s.metadata.deal_id ?? "-"}, enrolment ${s.metadata.enrolment_id ?? "-"}, class ${s.metadata.class_id ?? "-"}`,
    `Customer: ${s.customer_details?.name ?? "-"} <${s.customer_details?.email ?? "-"}>`,
  ].join("\n");
  await sql`
    INSERT INTO task (type, title, person_id, enrolment_id, payment_id,
                      assigned_user_id, due_at, notes, source_key)
    VALUES ('match_payment', 'Unmatched Stripe payment: match to a student',
            ${e?.person_id ?? null}, ${e?.id ?? null}, ${paymentId},
            ${await dutySuperAdmin()}, now(), ${notes},
            ${`stripe:${paymentId}:match`})
    ON CONFLICT DO NOTHING`;
}
