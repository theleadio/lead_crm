// The Stripe webhook against the database (§11.3, §15.2 go-live gate): what a
// paid checkout session records, the unmatched path, refunds, and that a
// replayed event never records money twice. Each test is rolled back (`it` in
// ./seed.ts). Stripe's API is faked: only the charges lookup that tells card
// from FPX is called.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  processStripeEvent,
  type StripeDeps,
  type StripeEvent,
} from "../lib/payments/stripe-webhook.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newUser } from "./seed.ts";

after(closeDb);

const chargeOf = (type: string): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({ data: [{ payment_method_details: { type } }] }),
      { status: 200 },
    )) as unknown as typeof fetch;

const deps = (type = "card"): StripeDeps => ({
  secretKey: "sk_test_fake",
  fetchImpl: chargeOf(type),
});

let n = 0;
const uid = (p: string) =>
  `${p}_${crypto.randomUUID().replaceAll("-", "")}${n++}`;

function paidSession(
  enrolmentId: string | null,
  over: Record<string, unknown> = {},
  type = "checkout.session.completed",
): StripeEvent {
  return {
    id: uid("evt"),
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: uid("cs_test"),
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: uid("pi"),
        amount_total: 320000,
        currency: "myr",
        client_reference_id: enrolmentId,
        metadata: enrolmentId
          ? { enrolment_id: enrolmentId, class_id: "c", deal_id: "d" }
          : {},
        customer_details: {
          name: "Tan Mei Ling",
          email: "meiling@example.com",
        },
        ...over,
      },
    },
  };
}

const enrolmentRow = async (id: string) =>
  (await db()`SELECT * FROM enrolment WHERE id = ${id}`)[0];
const paymentsOf = async (enrolmentId: string) =>
  await db()`SELECT * FROM payment WHERE enrolment_id = ${enrolmentId}`;
const eventTypes = async (enrolmentId: string) =>
  (
    await db()`
      SELECT type FROM event_outbox
      WHERE payload->>'enrolmentId' = ${enrolmentId} ORDER BY created_at, type`
  ).map((r) => r.type as string);
const integration = async (eventId: string) =>
  (
    await db()`
      SELECT status, error, payload FROM integration_event
      WHERE source = 'stripe' AND external_event_id = ${eventId}`
  )[0];

async function reservedEnrolment(capacity = 10) {
  const classId = await newClass({
    courseId: await newCourse(),
    priceMyr: "3200.00",
    capacity,
  });
  return { classId, enrolmentId: await enrol(classId, "reserved") };
}

it("a paid session records the payment and confirms the reservation", async () => {
  await newUser("super_admin");
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(enrolmentId);

  const r = await processStripeEvent(event, deps("card"));
  assert.equal(r.kind, "recorded");
  assert.ok(r.kind === "recorded" && r.matched && r.statusMoved);

  const [p] = await paymentsOf(enrolmentId);
  assert.equal(p.method, "stripe_card");
  assert.equal(p.status, "succeeded");
  assert.equal(p.amount_myr, "3200.00");
  assert.equal(p.match_status, "matched");
  assert.equal(p.stripe_checkout_session_id, event.data.object.id);
  assert.ok(p.paid_at);
  assert.equal((await enrolmentRow(enrolmentId)).status, "confirmed");
  assert.deepEqual(await eventTypes(enrolmentId), [
    "EnrolmentConfirmed",
    "PaymentRecorded",
  ]);
  assert.equal((await integration(event.id)).status, "processed");
});

it("FPX is recorded as stripe_fpx", async () => {
  const { enrolmentId } = await reservedEnrolment();
  await processStripeEvent(paidSession(enrolmentId), deps("fpx"));
  assert.equal((await paymentsOf(enrolmentId))[0].method, "stripe_fpx");
});

it("the same event delivered twice records the money once", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(enrolmentId);
  await processStripeEvent(event, deps());
  const again = await processStripeEvent(event, deps());
  assert.equal(again.kind, "duplicate");
  assert.equal((await paymentsOf(enrolmentId)).length, 1);
});

it("a second event for the same session (async succeeded after completed) records nothing new", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const first = paidSession(enrolmentId);
  await processStripeEvent(first, deps());
  const second: StripeEvent = {
    ...first,
    id: uid("evt"),
    type: "checkout.session.async_payment_succeeded",
  };
  assert.equal((await processStripeEvent(second, deps())).kind, "duplicate");
  assert.equal((await paymentsOf(enrolmentId)).length, 1);
});

it("an unpaid completed session (FPX still pending) is acknowledged, not recorded", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(enrolmentId, { payment_status: "unpaid" });
  const r = await processStripeEvent(event, deps());
  assert.equal(r.kind, "ignored");
  assert.equal((await paymentsOf(enrolmentId)).length, 0);
  assert.equal((await enrolmentRow(enrolmentId)).status, "reserved");
  assert.equal((await integration(event.id)).status, "ignored");
});

it("async_payment_succeeded confirms a pending FPX payment", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(
    enrolmentId,
    {},
    "checkout.session.async_payment_succeeded",
  );
  const r = await processStripeEvent(event, deps("fpx"));
  assert.ok(r.kind === "recorded" && r.statusMoved);
  assert.equal((await enrolmentRow(enrolmentId)).status, "confirmed");
});

it("a late payment on a confirmed student is recorded without a status move", async () => {
  const classId = await newClass({ courseId: await newCourse() });
  const enrolmentId = await enrol(classId, "confirmed");
  const r = await processStripeEvent(paidSession(enrolmentId), deps());
  assert.ok(r.kind === "recorded" && r.matched && !r.statusMoved);
  assert.equal((await enrolmentRow(enrolmentId)).status, "confirmed");
  assert.deepEqual(await eventTypes(enrolmentId), ["PaymentRecorded"]);
});

it("payment for a cancelled enrolment is stored unmatched with a match_payment task (§11.3)", async () => {
  const admin = await newUser("super_admin");
  const classId = await newClass({ courseId: await newCourse() });
  const enrolmentId = await enrol(classId, "cancelled");
  const event = paidSession(enrolmentId);

  const r = await processStripeEvent(event, deps());
  assert.ok(r.kind === "recorded" && !r.matched);

  const [p] = await db()`
    SELECT * FROM payment WHERE stripe_checkout_session_id = ${event.data.object.id as string}`;
  assert.equal(p.match_status, "unmatched");
  assert.equal(p.enrolment_id, null);
  assert.equal(p.status, "succeeded");
  const [t] = await db()`SELECT * FROM task WHERE payment_id = ${p.id}`;
  assert.equal(t.type, "match_payment");
  assert.match(t.notes, /cancelled/);
  assert.match(t.notes, /meiling@example\.com/);
  assert.equal(t.assigned_user_id, admin.id);
  assert.equal((await enrolmentRow(enrolmentId)).status, "cancelled");
});

it("payment naming no enrolment is stored unmatched", async () => {
  const event = paidSession(null);
  const r = await processStripeEvent(event, deps());
  assert.ok(r.kind === "recorded" && !r.matched);
});

it("an expired reservation whose seat was taken goes to unmatched, not oversold", async () => {
  const classId = await newClass({ courseId: await newCourse(), capacity: 1 });
  const late = await enrol(classId, "reserved", { reservedOffset: "-1 hour" });
  await enrol(classId, "confirmed");
  const r = await processStripeEvent(paidSession(late), deps());
  assert.ok(r.kind === "recorded" && !r.matched);
  assert.equal((await enrolmentRow(late)).status, "reserved");
});

it("the integration_event row keeps no customer details", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(enrolmentId);
  await processStripeEvent(event, deps());
  const kept = JSON.stringify((await integration(event.id)).payload);
  assert.doesNotMatch(kept, /meiling|Tan Mei Ling/);
});

it("a non-MYR session fails and is marked failed, so Stripe retries and Ops can see it", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const event = paidSession(enrolmentId, { currency: "usd" });
  await assert.rejects(processStripeEvent(event, deps()), /not MYR/);
  const row = await integration(event.id);
  assert.equal(row.status, "failed");
  assert.equal((await paymentsOf(enrolmentId)).length, 0);
});

it("a failed charges lookup throws (Stripe retries) and records nothing", async () => {
  const { enrolmentId } = await reservedEnrolment();
  const broken: StripeDeps = {
    secretKey: "sk_test_fake",
    fetchImpl: (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch,
  };
  const event = paidSession(enrolmentId);
  await assert.rejects(processStripeEvent(event, broken), /lookup failed/);
  assert.equal((await paymentsOf(enrolmentId)).length, 0);
  // The retry, once Stripe's API answers, does the work.
  const r = await processStripeEvent(event, deps());
  assert.equal(r.kind, "recorded");
});

it("a partial then full refund updates the payment and gives Ops a task, without moving the enrolment", async () => {
  await newUser("super_admin");
  const { enrolmentId } = await reservedEnrolment();
  const paid = paidSession(enrolmentId);
  await processStripeEvent(paid, deps());
  const pi = paid.data.object.payment_intent as string;

  const refund = (amount: number): StripeEvent => ({
    id: uid("evt"),
    type: "charge.refunded",
    data: {
      object: {
        id: uid("ch"),
        payment_intent: pi,
        amount: 320000,
        amount_refunded: amount,
      },
    },
  });

  assert.equal(
    (await processStripeEvent(refund(100000), deps())).kind,
    "refund_recorded",
  );
  let [p] = await paymentsOf(enrolmentId);
  assert.equal(p.status, "partially_refunded");
  assert.equal(p.refunded_amount_myr, "1000.00");
  assert.ok(p.refunded_at);

  assert.equal(
    (await processStripeEvent(refund(320000), deps())).kind,
    "refund_recorded",
  );
  [p] = await paymentsOf(enrolmentId);
  assert.equal(p.status, "refunded");
  assert.equal(p.refunded_amount_myr, "3200.00");

  // An older, smaller total arriving late changes nothing.
  assert.equal(
    (await processStripeEvent(refund(100000), deps())).kind,
    "duplicate",
  );

  const tasks = await db()`
    SELECT * FROM task WHERE enrolment_id = ${enrolmentId} AND type = 'other'`;
  assert.equal(tasks.length, 2);
  assert.equal((await enrolmentRow(enrolmentId)).status, "confirmed");
});

it("a refund for a payment the CRM never recorded is ignored", async () => {
  const event: StripeEvent = {
    id: uid("evt"),
    type: "charge.refunded",
    data: { object: { payment_intent: uid("pi"), amount_refunded: 5000 } },
  };
  assert.equal((await processStripeEvent(event, deps())).kind, "ignored");
});

it("events it doesn't handle are acknowledged and ignored", async () => {
  const event: StripeEvent = {
    id: uid("evt"),
    type: "checkout.session.expired",
    data: { object: { id: uid("cs") } },
  };
  assert.equal((await processStripeEvent(event, deps())).kind, "ignored");
});
