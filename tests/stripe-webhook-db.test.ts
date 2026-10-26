// Stripe webhook (spec §7, §11.3, §14): signature, staging, handlers, retry.
// Most tests run inside a rolled-back transaction; the concurrency test must
// commit, so it cleans up after itself. Skipped without DATABASE_URL.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "../lib/events/drain.ts";
import { makeHandlers } from "../lib/events/handlers.ts";
import {
  MAX_BODY_BYTES,
  handleStripeWebhook,
  type StripeWebhookDeps,
} from "../lib/integrations/stripe-webhook.ts";
import { processStripeEvents } from "../lib/integrations/stripe.ts";
import { verifyStripeSignature } from "../lib/integrations/stripe-signature.ts";
import { confirmWhenPaid } from "../lib/integrations/confirm.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newPerson, newUser, pay } from "./seed.ts";
import { purgeEnrolments } from "./support/purge.ts";

after(closeDb);
const skip = !process.env.DATABASE_URL && "no DATABASE_URL";

const SECRET = "whsec_" + randomBytes(16).toString("hex");
const env = { STRIPE_WEBHOOK_SECRET: SECRET };
const NOW = 1_800_000_000;
const deps: StripeWebhookDeps = { env, now: () => NOW };

function sign(body: string, secret = SECRET, t = NOW) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
const post = (body: string, header: string | null, d = deps) =>
  handleStripeWebhook(
    new Request("http://x/api/webhooks/stripe", {
      method: "POST",
      body,
      headers: header ? { "stripe-signature": header } : {},
    }),
    d,
  );

type Fix = {
  classId: string;
  enrolmentId: string;
  dealId: string;
  session: string;
  personId: string;
};
// A reserved enrolment on a RM500 class with a Checkout session on its deal.
async function fixture(
  opts: { status?: string; price?: string; classStatus?: string } = {},
): Promise<Fix> {
  const classId = await newClass({
    priceMyr: "500.00",
    status: opts.classStatus,
  });
  const personId = await newPerson(`P ${randomBytes(4).toString("hex")}`);
  const enrolmentId = await enrol(classId, opts.status ?? "reserved", {
    personId,
    pricePaid: opts.price ?? "500.00",
  });
  const session = "cs_test_" + randomBytes(8).toString("hex");
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, checkout_session_id)
    VALUES ('individual', 'checkout_sent', ${personId}, ${session})
    RETURNING id`;
  await db()`UPDATE enrolment SET deal_id = ${d.id} WHERE id = ${enrolmentId}`;
  return { classId, enrolmentId, dealId: d.id, session, personId };
}

function event(
  f: Fix,
  over: {
    id?: string;
    type?: string;
    amount?: number;
    status?: string;
    meta?: Record<string, string>;
    pi?: string | null;
  } = {},
) {
  return {
    id: over.id ?? "evt_" + randomBytes(8).toString("hex"),
    type: over.type ?? "checkout.session.completed",
    created: NOW - 5,
    data: {
      object: {
        id: f.session,
        payment_intent:
          over.pi === undefined
            ? "pi_" + randomBytes(8).toString("hex")
            : over.pi,
        payment_status: over.status ?? "paid",
        amount_total: over.amount ?? 50000,
        currency: "myr",
        client_reference_id: f.enrolmentId,
        expires_at: NOW + 3600,
        metadata: over.meta ?? {
          deal_id: f.dealId,
          enrolment_id: f.enrolmentId,
          class_id: f.classId,
        },
        customer_details: {
          email: "payer@example.com",
          name: "Pay Er",
          phone: "+60123456789",
          address: { line1: "1 Secret Street", postal_code: "50000" },
        },
        billing_address_collection: "required",
        shipping_details: { name: "Ship To" },
        payment_method_types: ["card"],
      },
    },
  };
}
const send = (e: object) => {
  const body = JSON.stringify(e);
  return post(body, sign(body));
};

const payments = (f: Fix) =>
  db()`SELECT * FROM payment WHERE stripe_checkout_session_id = ${f.session}`;
const statusOf = async (id: string) =>
  (
    await db()`SELECT status, cancelled_reason FROM enrolment WHERE id = ${id}`
  )[0];
const history = async (id: string) =>
  (
    await db()`SELECT count(*)::int AS n FROM enrolment_status_history WHERE enrolment_id = ${id}`
  )[0].n;
const tasksFor = (paymentId: string) =>
  db()`SELECT * FROM task WHERE payment_id = ${paymentId}`;
const outbox = (id: string, type: string) =>
  db()`SELECT 1 FROM event_outbox WHERE aggregate_id = ${id} AND type = ${type}`;
const parkOthers = () =>
  db()`UPDATE integration_event SET status = 'ignored' WHERE status IN ('received','failed')`;
// The duty super_admin must exist for the task assignee (O37).
const admin = () => newUser("super_admin");

// ---- signature ---------------------------------------------------------------

test("signature: valid, wrong secret, tampered body, old timestamp, missing, multiple v1", () => {
  const body = Buffer.from('{"a":1}');
  const good = sign(body.toString());
  assert.equal(verifyStripeSignature(body, good, SECRET, NOW), true);
  assert.equal(
    verifyStripeSignature(
      body,
      sign(body.toString(), "whsec_" + "x".repeat(20)),
      SECRET,
      NOW,
    ),
    false,
  );
  assert.equal(
    verifyStripeSignature(Buffer.from('{"a":2}'), good, SECRET, NOW),
    false,
  );
  assert.equal(verifyStripeSignature(body, good, SECRET, NOW + 301), false);
  assert.equal(verifyStripeSignature(body, good, SECRET, NOW - 301), false);
  assert.equal(verifyStripeSignature(body, good, SECRET, NOW + 299), true);
  assert.equal(verifyStripeSignature(body, null, SECRET, NOW), false);
  assert.equal(verifyStripeSignature(body, "garbage", SECRET, NOW), false);
  const bad = "v1=" + "0".repeat(64);
  assert.equal(
    verifyStripeSignature(body, `${good},${bad}`, SECRET, NOW),
    true,
  );
  assert.equal(
    verifyStripeSignature(body, good.replace(/v1=/, `${bad},v1=`), SECRET, NOW),
    true,
  );
});

test("route: bad signature 400 with no body; secret unset or short 503; oversize 413", async () => {
  const body = JSON.stringify({ id: "evt_x", type: "ping" });
  const noSig = await post(body, null);
  assert.equal(noSig.status, 400);
  assert.equal(await noSig.text(), "");
  assert.equal(
    (await post(body, sign(body, "whsec_" + "y".repeat(20)))).status,
    400,
  );
  assert.equal(
    (await post(body, sign(body), { env: {}, now: deps.now })).status,
    503,
  );
  assert.equal(
    (
      await post(body, sign(body), {
        env: { STRIPE_WEBHOOK_SECRET: "short" },
        now: deps.now,
      })
    ).status,
    503,
  );
  const big = "x".repeat(MAX_BODY_BYTES + 1);
  assert.equal((await post(big, sign(big))).status, 413);
});

test("route file exports POST only", async () => {
  const src = await readFile("app/api/webhooks/stripe/route.ts", "utf8");
  assert.deepEqual(
    src.match(/^export (?:const|async function|function) (\w+)/gm),
    ["export const POST"],
  );
});

// ---- staging -----------------------------------------------------------------

it("staging: reduced payload; unknown type stored ignored with 200; replay is a no-op", async () => {
  await admin();
  const f = await fixture();
  const e = event(f);
  assert.equal((await send(e)).status, 200);
  const [row] =
    await db()`SELECT payload, status FROM integration_event WHERE external_event_id = ${e.id}`;
  assert.equal(row.status, "processed");
  const text = JSON.stringify(row.payload);
  for (const leak of [
    "Secret Street",
    "postal_code",
    "+60123456789",
    "Ship To",
    "billing_address",
    "shipping",
  ])
    assert.ok(!text.includes(leak), `payload leaked ${leak}`);
  assert.equal(row.payload.session.customer_details.email, "payer@example.com");
  assert.equal(row.payload.session.amount_total, 50000);

  const other = {
    id: "evt_" + randomBytes(6).toString("hex"),
    type: "charge.refunded",
    created: NOW,
    data: { object: { id: "ch_1", billing_details: { name: "X" } } },
  };
  assert.equal((await send(other)).status, 200);
  const [o] =
    await db()`SELECT payload, status FROM integration_event WHERE external_event_id = ${other.id}`;
  assert.equal(o.status, "ignored");
  assert.ok(!JSON.stringify(o.payload).includes("billing"));

  assert.equal((await send(e)).status, 200); // replay
  assert.equal(
    (
      await db()`SELECT 1 FROM integration_event WHERE external_event_id = ${e.id}`
    ).length,
    1,
  );
});

// ---- completed ---------------------------------------------------------------

it("completed: payment recorded and enrolment confirmed; replay changes nothing", async () => {
  await admin();
  const f = await fixture();
  const e = event(f);
  assert.equal((await send(e)).status, 200);
  const [p] = await payments(f);
  assert.equal(p.match_status, "matched");
  assert.equal(p.status, "succeeded");
  assert.equal(p.method, "stripe_card");
  assert.equal(String(p.amount_myr), "500.00");
  assert.equal(p.enrolment_id, f.enrolmentId);
  assert.equal(p.deal_id, f.dealId);
  assert.ok(p.stripe_payment_intent_id.startsWith("pi_"));
  assert.equal((await statusOf(f.enrolmentId)).status, "confirmed");
  const h = await history(f.enrolmentId);
  assert.equal((await outbox(f.enrolmentId, "EnrolmentConfirmed")).length, 1);

  await send(e); // same event id
  await send({ ...e, id: "evt_other" }); // new event id, same payment
  assert.equal((await payments(f)).length, 1);
  // Nothing failed on the way: a replay is absorbed, not rejected by a constraint.
  const failed =
    await db()`SELECT 1 FROM integration_event WHERE status = 'failed' AND payload->'session'->>'id' = ${f.session}`;
  assert.equal(failed.length, 0);
  assert.equal(await history(f.enrolmentId), h);
  assert.equal((await outbox(f.enrolmentId, "EnrolmentConfirmed")).length, 1);
  assert.equal((await tasksFor(p.id)).length, 0);
  const [deal] = await db()`SELECT stage FROM deal WHERE id = ${f.dealId}`;
  assert.equal(deal.stage, "checkout_sent"); // spec silent: deal left alone
});

it("completed: unpaid (delayed method) records nothing; async_payment_succeeded does", async () => {
  await admin();
  const f = await fixture();
  await send(event(f, { status: "unpaid" }));
  assert.equal((await payments(f)).length, 0);
  await send(event(f, { type: "checkout.session.async_payment_succeeded" }));
  assert.equal((await payments(f)).length, 1);
  assert.equal((await statusOf(f.enrolmentId)).status, "confirmed");
});

it("part payment: a manual deposit then the Stripe balance confirms; a partial total parks in payment_pending", async () => {
  await admin();
  const f = await fixture();
  await pay(f.enrolmentId, { amount: "200.00" });
  await send(event(f, { amount: 30000 })); // balance 300
  const [p] = await payments(f);
  assert.equal(p.match_status, "matched");
  assert.equal((await statusOf(f.enrolmentId)).status, "confirmed");

  const g = await fixture();
  await pay(g.enrolmentId, { amount: "100.00" });
  assert.deepEqual(await confirmWhenPaid(g.enrolmentId), {
    from: "reserved",
    to: "payment_pending",
  });
  await pay(g.enrolmentId, { amount: "400.00" });
  assert.deepEqual(await confirmWhenPaid(g.enrolmentId), {
    from: "payment_pending",
    to: "confirmed",
  });
});

// ---- unmatched ---------------------------------------------------------------

async function assertUnmatched(
  f: Fix,
  e: ReturnType<typeof event>,
  reason: string,
) {
  const a = await admin();
  await db()`UPDATE app_user SET is_active = false WHERE role_code = 'super_admin' AND id <> ${a.id}`;
  assert.equal((await send(e)).status, 200);
  const [p] = await payments(f);
  assert.equal(p.match_status, "unmatched");
  assert.equal(p.enrolment_id, null);
  assert.equal(p.status, "succeeded");
  const t = await tasksFor(p.id);
  assert.equal(t.length, 1);
  assert.equal(t[0].type, "match_payment");
  assert.equal(t[0].assigned_user_id, a.id);
  assert.ok(t[0].notes.includes(`Why: ${reason}`), t[0].notes);
  assert.ok(t[0].notes.includes(f.session));
  assert.ok(!t[0].title.includes("payer@example.com"));
  await send(e); // replay: still one payment, one task
  assert.equal((await payments(f)).length, 1);
  assert.equal((await tasksFor(p.id)).length, 1);
}

it("unmatched: payment after the reservation was cancelled (expiry)", async () => {
  const f = await fixture();
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'reservation_expired' WHERE id = ${f.enrolmentId}`;
  await assertUnmatched(f, event(f), "enrolment_cancelled");
  assert.equal((await statusOf(f.enrolmentId)).status, "cancelled");
});

it("unmatched: class cancelled", async () => {
  const f = await fixture();
  await db()`UPDATE class SET status = 'cancelled', cancelled_reason = 'test' WHERE id = ${f.classId}`;
  await assertUnmatched(f, event(f), "class_cancelled");
});

it("unmatched: class_id in metadata disagrees; deal_id disagrees", async () => {
  const f = await fixture();
  const other = await newClass();
  await assertUnmatched(
    f,
    event(f, {
      meta: { deal_id: f.dealId, enrolment_id: f.enrolmentId, class_id: other },
    }),
    "class_mismatch",
  );
  assert.equal((await statusOf(f.enrolmentId)).status, "reserved");
  const g = await fixture();
  await assertUnmatched(
    g,
    event(g, {
      meta: {
        deal_id: crypto.randomUUID(),
        enrolment_id: g.enrolmentId,
        class_id: g.classId,
      },
    }),
    "deal_mismatch",
  );
});

it("unmatched: missing metadata and unknown enrolment", async () => {
  const f = await fixture();
  await assertUnmatched(f, event(f, { meta: {} }), "no_metadata");
  const g = await fixture();
  await assertUnmatched(
    g,
    event(g, {
      meta: { enrolment_id: crypto.randomUUID(), class_id: g.classId },
    }),
    "unknown_enrolment",
  );
});

it("unmatched: amount differs from the price; second full payment on a paid enrolment", async () => {
  const f = await fixture();
  await assertUnmatched(f, event(f, { amount: 49999 }), "amount_mismatch");
  assert.equal((await statusOf(f.enrolmentId)).status, "reserved");
  const g = await fixture({ status: "confirmed" });
  await pay(g.enrolmentId, { amount: "500.00" });
  await assertUnmatched(g, event(g), "already_paid");
});

// ---- expired -----------------------------------------------------------------

it("expired: a reserved enrolment is cancelled as checkout_expired, no Ops task, replay is a no-op", async () => {
  const f = await fixture();
  await parkOthers();
  const e = event(f, { type: "checkout.session.expired", status: "unpaid" });
  assert.equal((await send(e)).status, 200);
  assert.deepEqual(await statusOf(f.enrolmentId), {
    status: "cancelled",
    cancelled_reason: "checkout_expired",
  });
  const h = await history(f.enrolmentId);
  await send(e);
  await send({ ...e, id: "evt_again" });
  assert.equal(await history(f.enrolmentId), h);
  assert.equal((await outbox(f.enrolmentId, "EnrolmentCancelled")).length, 1);
  // The EnrolmentCancelled handler makes no task for this reason.
  await makeHandlers().EnrolmentCancelled!({
    id: crypto.randomUUID(),
    type: "EnrolmentCancelled",
    aggregateId: f.enrolmentId,
    payload: { enrolmentId: f.enrolmentId, reason: "checkout_expired" },
  });
  assert.equal(
    (await db()`SELECT 1 FROM task WHERE enrolment_id = ${f.enrolmentId}`)
      .length,
    0,
  );
});

it("expired: no effect on a non-reserved enrolment or a session that is not the deal's", async () => {
  const f = await fixture({ status: "confirmed" });
  await send(event(f, { type: "checkout.session.expired", status: "unpaid" }));
  assert.equal((await statusOf(f.enrolmentId)).status, "confirmed");
  const g = await fixture();
  await db()`UPDATE deal SET checkout_session_id = 'cs_newer' WHERE id = ${g.dealId}`;
  await send(event(g, { type: "checkout.session.expired", status: "unpaid" }));
  assert.equal((await statusOf(g.enrolmentId)).status, "reserved");
});

// ---- retry -------------------------------------------------------------------

it("failure: row marked failed with backoff, retried, dead after the cap", async () => {
  await parkOthers();
  const f = await fixture();
  // A foreign-currency charge is refused by the handler, so it fails.
  const e = event(f);
  (e.data.object as { currency: string }).currency = "usd";
  assert.equal((await send(e)).status, 200); // Stripe still gets its 200
  const row = async () =>
    (
      await db()`SELECT status, attempts, error, next_attempt_at > now() AS later FROM integration_event WHERE external_event_id = ${e.id}`
    )[0];
  let r = await row();
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, 1);
  assert.equal(r.later, true);
  assert.equal((await payments(f)).length, 0);
  // Not due: the retry run leaves it alone.
  assert.equal((await processStripeEvents()).claimed, 0);
  for (let n = 2; n <= MAX_ATTEMPTS; n++) {
    await db()`UPDATE integration_event SET next_attempt_at = now() WHERE external_event_id = ${e.id}`;
    const run = await processStripeEvents();
    assert.equal(run.failed, 1);
    assert.equal(run.dead, n === MAX_ATTEMPTS ? 1 : 0);
  }
  r = await row();
  assert.equal(r.attempts, MAX_ATTEMPTS);
  await db()`UPDATE integration_event SET next_attempt_at = now() WHERE external_event_id = ${e.id}`;
  assert.equal((await processStripeEvents()).claimed, 0); // dead: never claimed again
  assert.ok(BACKOFF_SECONDS.length >= 1);
});

it("retry: a failed row that now works is processed by the job", async () => {
  await parkOthers();
  await admin();
  const f = await fixture();
  const e = event(f);
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'x' WHERE id = ${f.enrolmentId}`;
  await send(e);
  await db()`UPDATE integration_event SET status = 'failed', attempts = 1, next_attempt_at = now() WHERE external_event_id = ${e.id}`;
  await db()`DELETE FROM task WHERE payment_id IN (SELECT id FROM payment WHERE stripe_checkout_session_id = ${f.session})`;
  await db()`DELETE FROM payment WHERE stripe_checkout_session_id = ${f.session}`;
  const run = await processStripeEvents();
  assert.equal(run.processed, 1);
  assert.equal((await payments(f)).length, 1);
});

// ---- concurrency (committed data) --------------------------------------------

test(
  "concurrency: two identical events at once make one payment",
  { skip },
  async () => {
    // Committed fixture, removed in finally.
    const f = await fixture();
    const e = event(f);
    try {
      const rs = await Promise.all([send(e), send(e), send(e)]);
      assert.deepEqual(
        rs.map((r) => r.status),
        [200, 200, 200],
      );
      assert.equal((await payments(f)).length, 1);
      assert.equal((await statusOf(f.enrolmentId)).status, "confirmed");
      assert.equal(
        (await outbox(f.enrolmentId, "EnrolmentConfirmed")).length,
        1,
      );
    } finally {
      await db()`DELETE FROM task WHERE payment_id IN (SELECT id FROM payment WHERE stripe_checkout_session_id = ${f.session})`;
      await db()`DELETE FROM payment WHERE stripe_checkout_session_id = ${f.session}`;
      await db()`DELETE FROM event_outbox WHERE aggregate_id = ${f.enrolmentId}`;
      await db()`DELETE FROM integration_event WHERE external_event_id = ${e.id}`;
      await purgeEnrolments([f.enrolmentId]);
      await db()`DELETE FROM deal_stage_history WHERE deal_id = ${f.dealId}`;
      await db()`DELETE FROM deal WHERE id = ${f.dealId}`;
      await db()`DELETE FROM person WHERE id = ${f.personId}`;
      await db()`DELETE FROM class WHERE id = ${f.classId}`;
    }
  },
);
