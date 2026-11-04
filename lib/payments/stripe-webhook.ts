import { createHmac, timingSafeEqual } from "node:crypto";
import { writeAudit } from "../audit.ts";
import { canChangeTo } from "../enrolments/status-rules.ts";
import { dutySuperAdmin } from "../people/duplicate-review.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import {
  BLOCKED_STATUSES,
  SEAT_GUARD_EXEMPT,
  holdsSeat,
  isNoSeats,
  seatsTaken,
} from "./service.ts";

// The Stripe webhook, §11.3 and the §15.2 go-live gate: without it a paid
// reservation stays `reserved` and expires, freeing the seat although the
// student paid. It reads the three metadata names the checkout session
// carries (`lib/payments/checkout.ts`, §8.3 session contract).
//
// What it does, per Stripe event:
//   checkout.session.completed (payment_status "paid") and
//   checkout.session.async_payment_succeeded (FPX and other delayed methods)
//     → record a succeeded `payment` and confirm the enrolment, with the same
//       §12.4 move, §12.1 seat guard and §11.1 events as the manual payment
//       (`recordManualPayment` in ./service.ts). When the payment can't be
//       matched to a live enrolment it is stored `unmatched` with a
//       `match_payment` task (§11.3) — money is never dropped.
//   charge.refunded
//     → update the payment's refunded amount and status (migration 009's
//       rules), and give Ops a task to decide the enrolment. The webhook does
//       not move the enrolment itself: a refund can be a goodwill partial
//       refund as easily as a cancellation.
//   anything else → acknowledged and ignored.
//
// Idempotency: each Stripe event id is claimed once in `integration_event`
// (unique on source + external_event_id), and the payment row is unique on
// its checkout session (migration 009), so a retried or replayed event never
// records money twice.
//
// Event names and field names were checked against Stripe's official Node
// library (stripe 23.1.0, `resources/Checkout/Sessions.d.ts`, `Charges.d.ts`,
// `Webhooks.js`).

export type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  data: { object: Record<string, unknown> };
};

export type StripeDeps = {
  // STRIPE_SECRET_KEY: used only to read which method paid (card or FPX).
  secretKey: string | null;
  fetchImpl?: typeof fetch;
};

export type StripeResult =
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | {
      kind: "recorded";
      paymentId: string;
      matched: boolean;
      statusMoved: boolean;
    }
  | { kind: "refund_recorded"; paymentId: string };

// ---- Signature (Stripe-Signature header) -------------------------------------

// Stripe's own default, `Webhook.DEFAULT_TOLERANCE` in the official library.
export const SIGNATURE_TOLERANCE_SECONDS = 300;

// Header `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`; the signed content is
// `<t>.<raw body>`, HMAC-SHA256 with the endpoint secret, hex. Any one v1 may
// match (Stripe sends several while a secret is being rolled).
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  tolerance: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  let timestamp = -1;
  const signatures: string[] = [];
  for (const item of header.split(",")) {
    const [k, v] = item.split("=");
    if (k === "t") timestamp = Number.parseInt(v ?? "", 10);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || timestamp < 0 || signatures.length === 0)
    return false;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();
  return signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// ---- Small readers -----------------------------------------------------------

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// Stripe amounts are in the smallest unit (sen for MYR).
const myr = (sen: number): string => (sen / 100).toFixed(2);
const senOf = (amountMyr: unknown): number =>
  Math.round(Number(amountMyr) * 100);

// The payload kept in `integration_event`: what the webhook acted on, never
// the customer's details (PDPA — the raw event carries name, email, address).
function keptPayload(event: StripeEvent): Record<string, unknown> {
  const o = event.data.object;
  return {
    type: event.type,
    objectId: str(o.id),
    paymentIntent: str(o.payment_intent),
    metadata: obj(o.metadata),
    amountTotal: o.amount_total ?? null,
    amountRefunded: o.amount_refunded ?? null,
    currency: str(o.currency),
    paymentStatus: str(o.payment_status),
  };
}

// ---- integration_event bookkeeping ------------------------------------------

// True when this delivery should do the work: a new event, or one whose
// earlier delivery failed (Stripe retries until it gets a 2xx).
async function claim(event: StripeEvent): Promise<boolean> {
  const sql = db();
  const [row] = await sql`
    INSERT INTO integration_event (source, external_event_id, payload)
    VALUES ('stripe', ${event.id}, ${sql.json(keptPayload(event) as never)})
    ON CONFLICT (source, external_event_id) DO NOTHING
    RETURNING id`;
  if (row) return true;
  const [existing] = await sql`
    SELECT status FROM integration_event
    WHERE source = 'stripe' AND external_event_id = ${event.id}`;
  return existing?.status === "received" || existing?.status === "failed";
}

async function settle(
  event: StripeEvent,
  status: "processed" | "ignored" | "failed",
  error: string | null = null,
): Promise<void> {
  await db()`
    UPDATE integration_event
    SET status = ${status}, processed_at = now(), error = ${error},
        updated_at = now()
    WHERE source = 'stripe' AND external_event_id = ${event.id}`;
}

// ---- Entry point -------------------------------------------------------------

export async function processStripeEvent(
  event: StripeEvent,
  deps: StripeDeps,
): Promise<StripeResult> {
  if (!(await claim(event))) return { kind: "duplicate" };
  try {
    const result = await dispatch(event, deps);
    await settle(
      event,
      result.kind === "ignored" ? "ignored" : "processed",
      result.kind === "ignored" ? result.reason : null,
    );
    return result;
  } catch (e) {
    // The message only: a database error's `detail` can hold an email.
    await settle(event, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function dispatch(
  event: StripeEvent,
  deps: StripeDeps,
): Promise<StripeResult> {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      // A delayed method (FPX) completes the session "unpaid" first and
      // sends async_payment_succeeded later; only money that arrived is a
      // payment (§9.12 records a payment once it has arrived).
      if (o.payment_status !== "paid")
        return {
          kind: "ignored",
          reason: `payment_status ${String(o.payment_status)}; waiting for async_payment_succeeded`,
        };
      return onPaid(event, deps);
    case "checkout.session.async_payment_succeeded":
      return onPaid(event, deps);
    case "charge.refunded":
      return onRefund(event);
    default:
      // async_payment_failed and expired need nothing: the reservation runs
      // out on its own (expire_reservations(), §12.1).
      return { kind: "ignored", reason: `not handled: ${event.type}` };
  }
}

// ---- Payment method ----------------------------------------------------------

// The session doesn't say which method paid, so read the charge. Only card
// and FPX exist in `payment.method`; any other Stripe method is stored as
// stripe_card and named in the notes, so nothing is lost.
async function methodOf(
  paymentIntent: string,
  deps: StripeDeps,
): Promise<{ method: "stripe_card" | "stripe_fpx"; type: string }> {
  if (!deps.secretKey)
    throw new Error(
      "STRIPE_SECRET_KEY is not set: cannot read the payment method",
    );
  const url = new URL("https://api.stripe.com/v1/charges");
  url.searchParams.set("payment_intent", paymentIntent);
  url.searchParams.set("limit", "1");
  const res = await (deps.fetchImpl ?? fetch)(url, {
    headers: { authorization: `Bearer ${deps.secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Stripe charges lookup failed: ${res.status}`);
  const body = (await res.json()) as {
    data?: { payment_method_details?: { type?: string } | null }[];
  };
  const type = body.data?.[0]?.payment_method_details?.type;
  if (!type)
    throw new Error("Stripe charges lookup: no charge for this payment yet");
  return { method: type === "fpx" ? "stripe_fpx" : "stripe_card", type };
}

// ---- Paid session → payment --------------------------------------------------

type PaidSession = {
  sessionId: string;
  paymentIntent: string;
  amountMyr: string;
  paidAt: Date;
  method: "stripe_card" | "stripe_fpx";
  methodType: string;
  enrolmentId: string | null;
  metadata: Record<string, unknown>;
  customer: { name: string | null; email: string | null };
};

async function onPaid(
  event: StripeEvent,
  deps: StripeDeps,
): Promise<StripeResult> {
  const o = event.data.object;
  const sessionId = str(o.id);
  const paymentIntent = str(o.payment_intent);
  if (!sessionId || !paymentIntent)
    throw new Error("checkout session without an id or payment_intent");
  if (str(o.currency)?.toLowerCase() !== "myr")
    throw new Error(`currency ${String(o.currency)} is not MYR (§4)`);
  const sen = o.amount_total;
  if (typeof sen !== "number" || !Number.isInteger(sen) || sen <= 0)
    throw new Error("checkout session without a positive amount_total");

  const [already] = await db()`
    SELECT id FROM payment
    WHERE stripe_checkout_session_id = ${sessionId}
       OR stripe_payment_intent_id = ${paymentIntent}`;
  if (already) return { kind: "duplicate" };

  const metadata = obj(o.metadata);
  const customer = obj(o.customer_details);
  const { method, type } = await methodOf(paymentIntent, deps);
  const paid: PaidSession = {
    sessionId,
    paymentIntent,
    amountMyr: myr(sen),
    paidAt: new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000),
    method,
    methodType: type,
    enrolmentId: str(metadata.enrolment_id) ?? str(o.client_reference_id),
    metadata,
    customer: { name: str(customer.name), email: str(customer.email) },
  };

  if (!paid.enrolmentId || !isUuid(paid.enrolmentId))
    return recordUnmatched(paid, "the payment names no enrolment");

  try {
    const outcome = await recordMatched(paid, paid.enrolmentId);
    if (outcome.kind === "unmatched")
      return recordUnmatched(paid, outcome.reason);
    return outcome;
  } catch (e) {
    // Migration 006: confirming would oversell (the reservation had run out
    // and the seat was taken). Ops decide, as for any unmatched payment.
    if (isNoSeats(e))
      return recordUnmatched(
        paid,
        "the class has no seat left for this enrolment",
      );
    if (isDuplicateStripe(e)) return { kind: "duplicate" };
    throw e;
  }
}

// Migration 001/009: one payment per payment intent and per checkout session.
// Two deliveries racing past the SELECT above meet here.
function isDuplicateStripe(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string };
  return (
    err.code === "23505" &&
    (err.constraint_name === "payment_stripe_intent_uq" ||
      err.constraint_name === "payment_stripe_session_uq")
  );
}

async function recordMatched(
  paid: PaidSession,
  enrolmentId: string,
): Promise<StripeResult | { kind: "unmatched"; reason: string }> {
  return withTransaction(async () => {
    const sql = db();
    const [enrolment] = await sql`
      SELECT e.*, p.preferred_language AS person_language
      FROM enrolment e JOIN person p ON p.id = e.person_id
      WHERE e.id = ${enrolmentId} FOR UPDATE OF e`;
    if (!enrolment)
      return {
        kind: "unmatched" as const,
        reason: "the enrolment does not exist",
      };

    const from = enrolment.status as string;
    if (BLOCKED_STATUSES.includes(from))
      return {
        kind: "unmatched" as const,
        reason: `the enrolment is ${from} (e.g. the reservation expired before the payment arrived)`,
      };

    // §12.4, the same table the manual payment and the status control read.
    const statusMoved = canChangeTo(from, "confirmed");

    const [cls] = await sql`
      SELECT id, code, status, capacity FROM class
      WHERE id = ${enrolment.class_id} FOR UPDATE`;
    if (
      statusMoved &&
      !holdsSeat(from) &&
      !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
      (await seatsTaken(cls.id as string)) >= (cls.capacity as number)
    )
      return {
        kind: "unmatched" as const,
        reason: `class ${cls.code as string} has no seat left for this enrolment`,
      };

    const [payment] = await sql`
      INSERT INTO payment (enrolment_id, deal_id, match_status, method, status,
                           amount_myr, stripe_payment_intent_id,
                           stripe_checkout_session_id, paid_at, notes)
      VALUES (${enrolmentId}, ${enrolment.deal_id}, 'matched', ${paid.method},
              'succeeded', ${paid.amountMyr}, ${paid.paymentIntent},
              ${paid.sessionId}, ${paid.paidAt},
              ${`Stripe ${paid.methodType} payment`})
      RETURNING id`;

    // Status when §12.4 allows it; otherwise updated_at alone, so the 005
    // trigger bumps `version` and an open screen learns it is behind — the
    // same two writes as the manual payment.
    if (statusMoved)
      await sql`UPDATE enrolment SET status = 'confirmed' WHERE id = ${enrolmentId}`;
    else
      await sql`UPDATE enrolment SET updated_at = now() WHERE id = ${enrolmentId}`;

    // §11.1: exact names, in the same transaction as the money. The system
    // actor is NULL, as for every worker write.
    await sql`
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
      VALUES ('PaymentRecorded', 'payment', ${payment.id},
              ${sql.json({
                paymentId: payment.id as string,
                enrolmentId,
                method: paid.method,
                amountMyr: paid.amountMyr,
              })})`;
    if (statusMoved)
      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
        VALUES ('EnrolmentConfirmed', 'enrolment', ${enrolmentId},
                ${sql.json({
                  enrolmentId,
                  personId: enrolment.person_id as string,
                  classId: enrolment.class_id as string,
                  language: enrolment.person_language as string,
                })})`;

    await writeAudit({
      userId: null,
      action: "create",
      entity: "payment",
      entityId: payment.id as string,
      before: null,
      after: {
        enrolment_id: enrolmentId,
        method: paid.method,
        amount_myr: paid.amountMyr,
        stripe_checkout_session_id: paid.sessionId,
        source: "stripe_webhook",
      },
    });
    if (statusMoved)
      await writeAudit({
        userId: null,
        action: "update",
        entity: "enrolment",
        entityId: enrolmentId,
        before: { status: from },
        after: { status: "confirmed", payment_id: payment.id },
      });

    return {
      kind: "recorded" as const,
      paymentId: payment.id as string,
      matched: true,
      statusMoved,
    };
  });
}

// §11.3: real money that can't be matched is stored and handed to Ops, with
// everything they need to find the right person and class.
async function recordUnmatched(
  paid: PaidSession,
  reason: string,
): Promise<StripeResult> {
  return withTransaction(async () => {
    const sql = db();
    const [payment] = await sql`
      INSERT INTO payment (match_status, method, status, amount_myr,
                           stripe_payment_intent_id, stripe_checkout_session_id,
                           paid_at, notes)
      VALUES ('unmatched', ${paid.method}, 'succeeded', ${paid.amountMyr},
              ${paid.paymentIntent}, ${paid.sessionId}, ${paid.paidAt},
              ${`Unmatched Stripe ${paid.methodType} payment: ${reason}`})
      RETURNING id`;

    const notes = [
      `Why: ${reason}.`,
      `Paid: RM ${paid.amountMyr} by ${paid.methodType}.`,
      `Payer: ${paid.customer.name ?? "no name"}, ${paid.customer.email ?? "no email"}.`,
      `Stripe checkout session: ${paid.sessionId}.`,
      `Metadata: enrolment ${String(paid.metadata.enrolment_id ?? "none")}, ` +
        `class ${String(paid.metadata.class_id ?? "none")}, ` +
        `deal ${String(paid.metadata.deal_id ?? "none")}.`,
    ].join("\n");
    await sql`
      INSERT INTO task (type, title, payment_id, assigned_user_id, due_at,
                        notes, source_key)
      VALUES ('match_payment', ${`Match a Stripe payment of RM ${paid.amountMyr}`},
              ${payment.id}, ${await dutySuperAdmin()}, now(), ${notes},
              ${`stripe:${paid.sessionId}:match`})
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;

    await writeAudit({
      userId: null,
      action: "create",
      entity: "payment",
      entityId: payment.id as string,
      before: null,
      after: {
        match_status: "unmatched",
        method: paid.method,
        amount_myr: paid.amountMyr,
        stripe_checkout_session_id: paid.sessionId,
        reason,
        source: "stripe_webhook",
      },
    });

    return {
      kind: "recorded" as const,
      paymentId: payment.id as string,
      matched: false,
      statusMoved: false,
    };
  });
}

// ---- Refund ------------------------------------------------------------------

async function onRefund(event: StripeEvent): Promise<StripeResult> {
  const charge = event.data.object;
  const paymentIntent = str(charge.payment_intent);
  const refundedSen = charge.amount_refunded;
  if (!paymentIntent || typeof refundedSen !== "number" || refundedSen <= 0)
    return {
      kind: "ignored",
      reason: "refund without a payment_intent or amount",
    };

  return withTransaction(async (): Promise<StripeResult> => {
    const sql = db();
    const [payment] = await sql`
      SELECT * FROM payment WHERE stripe_payment_intent_id = ${paymentIntent}
      FOR UPDATE`;
    // A refund of a payment this CRM never recorded (e.g. from before the
    // webhook existed, or taken outside Checkout).
    if (!payment)
      return {
        kind: "ignored",
        reason: "no payment recorded for this payment_intent",
      };

    const amountSen = senOf(payment.amount_myr);
    const newSen = Math.min(refundedSen, amountSen);
    // Stripe's amount_refunded is the running total, so an older or repeated
    // event never lowers what is stored.
    if (newSen <= senOf(payment.refunded_amount_myr))
      return { kind: "duplicate" };

    const status = newSen >= amountSen ? "refunded" : "partially_refunded";
    await sql`
      UPDATE payment
      SET refunded_amount_myr = ${myr(newSen)}, status = ${status},
          refunded_at = now()
      WHERE id = ${payment.id}`;

    if (payment.enrolment_id)
      await sql`
        INSERT INTO task (type, title, person_id, enrolment_id,
                          assigned_user_id, due_at, notes, source_key)
        SELECT 'other', 'Stripe refund recorded: decide the enrolment',
               e.person_id, e.id, ${await dutySuperAdmin()}, now(),
               ${
                 `RM ${myr(newSen)} of RM ${myr(amountSen)} refunded in Stripe (${status}). ` +
                 "The enrolment was not changed: cancel or refund it here if the student is not coming."
               },
               ${`stripe:${event.id}:refund`}
        FROM enrolment e WHERE e.id = ${payment.enrolment_id}
        ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;

    await writeAudit({
      userId: null,
      action: "update",
      entity: "payment",
      entityId: payment.id as string,
      before: {
        status: payment.status,
        refunded_amount_myr: payment.refunded_amount_myr,
      },
      after: {
        status,
        refunded_amount_myr: myr(newSen),
        source: "stripe_webhook",
      },
    });

    return { kind: "refund_recorded", paymentId: payment.id as string };
  });
}
