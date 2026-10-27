// §8.3 against the database: every answer the route gives, the seat the
// reservation holds, what reaches Stripe, what is captured even when the
// class is refused, and what a replayed key does. The payment provider is a
// fake — nothing here reaches the network. Rolled back, except the one
// concurrency test, which commits and cleans up after itself.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRegister } from "../lib/public/handlers.ts";
import type {
  CheckoutInput,
  CheckoutResult,
} from "../lib/payments/checkout.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newClass, newCourse, newPerson } from "./seed.ts";
import { normalizePhoneE164 } from "../lib/format/phone.ts";

after(closeDb);

const KEY = "test-key-0123456789abcdef";
const ORIGIN = "https://thelead.io";
const ENV = {
  PUBLIC_API_KEY: KEY,
  RATE_LIMIT_SECRET: "rl-secret-0123456789abcdef",
  PUBLIC_ALLOWED_ORIGINS: ORIGIN,
  APP_BASE_URL: "https://lead.test",
  STRIPE_SECRET_KEY: "sk_test_x",
};

let n = 0;
const nextIp = () => `10.${(++n >> 8) & 255}.${n & 255}.9`;
const uniqueEmail = () => `${crypto.randomUUID()}@example.com`;
function uniquePhone(): string {
  for (;;) {
    const p = `012${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    if (normalizePhoneE164(p)) return p;
  }
}

// A fake provider. Records what it was asked for, so the metadata contract
// with Shawn's webhook is asserted on the real input the route builds.
function fakeCheckout(answer?: CheckoutResult) {
  const calls: CheckoutInput[] = [];
  return {
    calls,
    port: async (input: CheckoutInput): Promise<CheckoutResult> => {
      calls.push(input);
      return (
        answer ?? {
          kind: "ok",
          id: `cs_${calls.length}`,
          url: `https://pay.test/${calls.length}`,
        }
      );
    },
  };
}

const classCode = async (classId: string) =>
  (await db()`SELECT code FROM class WHERE id = ${classId}`)[0].code as string;

function post(
  payload: Record<string, unknown>,
  o: {
    checkout?: (i: CheckoutInput) => Promise<CheckoutResult>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  return handleRegister(
    new Request("https://crm.test/api/public/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "x-real-ip": nextIp(),
        // Headers a caller could lie with. The return addresses below come
        // from APP_BASE_URL whatever these say.
        host: "evil.test",
        "x-forwarded-host": "evil.test",
      },
      body: JSON.stringify(payload),
    }),
    {
      env: o.env ?? ENV,
      captcha: async (t) => t === "good",
      checkout: o.checkout ?? fakeCheckout().port,
    },
  );
}

const form = (classCodeValue: string, o: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(),
  fullName: "Tan Mei Ling",
  email: uniqueEmail(),
  classCode: classCodeValue,
  hrdcIntended: false,
  captchaToken: "good",
  ...o,
});

async function created(res: Response) {
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as {
    ok: true;
    next: "checkout" | "hrdc_contact";
    checkoutUrl?: string;
    personId: string;
    dealId: string;
  };
}
const refused = async (res: Response, status: number, code: string) => {
  assert.equal(res.status, status, await res.clone().text());
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, code);
};

// ---- The happy path (§8.3 step 4) -----------------------------------------

it("a registration reserves a seat for 24 hours and answers with the payment page", async () => {
  const classId = await newClass({ capacity: 5, priceMyr: "3200.00" });
  const stripe = fakeCheckout();
  const out = await created(
    await post(form(await classCode(classId)), { checkout: stripe.port }),
  );
  assert.equal(out.next, "checkout");
  assert.equal(out.checkoutUrl, "https://pay.test/1");

  const [e] = await db()`
    SELECT status, seat_reserved_until, price_paid_myr, deal_id, payer_type
    FROM enrolment WHERE person_id = ${out.personId} AND class_id = ${classId}`;
  assert.equal(e.status, "reserved");
  assert.equal(e.deal_id, out.dealId);
  assert.equal(e.payer_type, "self");
  // The price is a snapshot of the class's, not of anything sent (§12.7).
  assert.equal(String(e.price_paid_myr), "3200.00");
  const hours =
    (new Date(e.seat_reserved_until as string).getTime() - Date.now()) /
    3_600_000;
  assert.ok(hours > 23.5 && hours <= 24, `hold is ${hours}h, want 24`);

  // Stripe was given the same moment the seat dies at.
  assert.equal(
    stripe.calls[0].expiresAt.toISOString(),
    new Date(e.seat_reserved_until as string).toISOString(),
  );
  // And the link is on the deal, not only in the answer (§13).
  const [d] = await db()`
    SELECT checkout_url, checkout_session_id, checkout_sent_at, stage
    FROM deal WHERE id = ${out.dealId}`;
  assert.equal(d.checkout_url, "https://pay.test/1");
  assert.equal(d.checkout_session_id, "cs_1");
  assert.ok(d.checkout_sent_at);
  // O44 is unanswered, so the stage is left where §8.2 put it.
  assert.equal(d.stage, "new");

  // One EnrolmentCreated, in the same transaction as the seat (§11.1).
  const [{ n: events }] = await db()`
    SELECT count(*)::int AS n FROM event_outbox
    WHERE type = 'EnrolmentCreated' AND aggregate_id = (
      SELECT id FROM enrolment WHERE person_id = ${out.personId})`;
  assert.equal(events, 1);
});

it("the session carries the three metadata ids and the class's own price", async () => {
  const courseId = await newCourse();
  // No class price: the course list price is what is charged (§8.3).
  await db()`UPDATE course SET list_price_myr = 1800 WHERE id = ${courseId}`;
  const classId = await newClass({ courseId, priceMyr: null });
  const stripe = fakeCheckout();
  const out = await created(
    await post(
      // A price in the body is ignored: nothing in a request can set an amount.
      form(await classCode(classId), { priceMyr: "1.00", amount: 1 }),
      { checkout: stripe.port },
    ),
  );
  const call = stripe.calls[0];
  assert.equal(call.amountMyr, "1800.00");
  assert.equal(call.dealId, out.dealId);
  assert.equal(call.classId, classId);
  const [e] = await db()`SELECT id FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(call.enrolmentId, e.id);
  // The configured base, although the request claimed to be evil.test.
  assert.ok(call.successUrl.startsWith("https://lead.test/register/thank-you"));
  assert.ok(call.cancelUrl.startsWith("https://lead.test/register/"));
});

it("a Chinese registration comes back to the Chinese thank-you page", async () => {
  const classId = await newClass({});
  const stripe = fakeCheckout();
  await created(
    await post(form(await classCode(classId), { locale: "zh" }), {
      checkout: stripe.port,
    }),
  );
  assert.ok(
    stripe.calls[0].successUrl.startsWith("https://lead.test/zh/register/"),
  );
  assert.ok(
    stripe.calls[0].cancelUrl.startsWith("https://lead.test/zh/register/"),
  );
});

// ---- HRDC (§10.4, §12.6) ---------------------------------------------------

it("HRDC never reaches the provider and reserves no seat", async () => {
  const classId = await newClass({});
  const stripe = fakeCheckout();
  const out = await created(
    await post(form(await classCode(classId), { hrdcIntended: true }), {
      checkout: stripe.port,
    }),
  );
  assert.equal(out.next, "hrdc_contact");
  assert.equal(stripe.calls.length, 0);
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(n, 0);
  // The deal is the HRDC one §8.2 creates, so Ops can see what was asked for.
  const [d] =
    await db()`SELECT funding_type FROM deal WHERE id = ${out.dealId}`;
  assert.equal(d.funding_type, "hrdc");
});

it("HRDC still works with no payment provider configured", async () => {
  const classId = await newClass({});
  const out = await created(
    await post(form(await classCode(classId), { hrdcIntended: true }), {
      env: { ...ENV, STRIPE_SECRET_KEY: undefined },
    }),
  );
  assert.equal(out.next, "hrdc_contact");
});

// ---- Refusals (§8.3 step 2, step 4) ---------------------------------------

it("a class the schedule does not show is refused, and the lead is still captured", async () => {
  for (const [label, opts] of [
    ["draft", { status: "draft" }],
    ["cancelled", { status: "cancelled" }],
    ["completed", { status: "completed" }],
    ["started today", { startOffsetDays: 0 }],
    ["already started", { startOffsetDays: -3 }],
  ] as const) {
    const classId = await newClass(opts);
    const email = uniqueEmail();
    await refused(
      await post(form(await classCode(classId), { email })),
      409,
      "class_unavailable",
    );
    const [{ n }] = await db()`
      SELECT count(*)::int AS n FROM person WHERE email_norm = ${email.toLowerCase()}`;
    assert.equal(n, 1, `${label}: the lead is kept`);
    const [{ n: seats }] = await db()`
      SELECT count(*)::int AS n FROM enrolment WHERE class_id = ${classId}`;
    assert.equal(seats, 0, `${label}: no seat`);
  }
});

it("a private class is refused even while it is open", async () => {
  const classId = await newClass({});
  await db()`UPDATE class SET is_public = false WHERE id = ${classId}`;
  await refused(
    await post(form(await classCode(classId))),
    409,
    "class_unavailable",
  );
});

it("an unknown code is refused and the code's case does not matter", async () => {
  await refused(await post(form("NO-SUCH-CLASS")), 409, "class_unavailable");
  const classId = await newClass({});
  const code = await classCode(classId);
  const out = await created(await post(form(code.toLowerCase())));
  assert.equal(out.next, "checkout");
});

it("a full class answers no_seats and creates no enrolment", async () => {
  const classId = await newClass({ capacity: 1 });
  const other = await newPerson("Already booked", uniquePhone());
  await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until)
    VALUES (${other}, ${classId}, 'reserved', now() + interval '24 hours')`;
  const stripe = fakeCheckout();
  await refused(
    await post(form(await classCode(classId)), { checkout: stripe.port }),
    409,
    "no_seats",
  );
  assert.equal(
    stripe.calls.length,
    0,
    "nothing is charged for a seat we do not have",
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(n, 1);
});

it("someone already past reserved is told they are registered, not charged again", async () => {
  const classId = await newClass({ capacity: 5 });
  const phone = uniquePhone();
  const code = await classCode(classId);
  const first = await created(
    await post(form(code, { phone, email: undefined })),
  );
  // The webhook would move it on; this is what the visitor comes back to.
  await db()`
    UPDATE enrolment SET status = 'confirmed', seat_reserved_until = NULL
    WHERE person_id = ${first.personId} AND class_id = ${classId}`;
  const stripe = fakeCheckout();
  await refused(
    await post(form(code, { phone, email: undefined }), {
      checkout: stripe.port,
    }),
    409,
    "already_enrolled",
  );
  assert.equal(stripe.calls.length, 0);
});

it("an unpaid reservation of their own is reused, never doubled", async () => {
  const classId = await newClass({ capacity: 5 });
  const phone = uniquePhone();
  const code = await classCode(classId);
  const stripe = fakeCheckout();
  const first = await created(
    await post(form(code, { phone, email: undefined }), {
      checkout: stripe.port,
    }),
  );
  const second = await created(
    await post(form(code, { phone, email: undefined }), {
      checkout: stripe.port,
    }),
  );
  assert.equal(second.personId, first.personId, "§12.2 matched them by phone");
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM enrolment
    WHERE person_id = ${first.personId} AND class_id = ${classId}`;
  assert.equal(n, 1, "one seat, one reservation");
  // One reservation, so one idempotency key: the provider decides whether to
  // hand back the same page, which is what keeps it at one live page.
  assert.equal(stripe.calls.length, 2);
  assert.equal(stripe.calls[0].enrolmentId, stripe.calls[1].enrolmentId);
});

it("no payment provider means 503 and no reservation", async () => {
  const classId = await newClass({});
  const res = await post(form(await classCode(classId)), {
    env: { ...ENV, STRIPE_SECRET_KEY: undefined },
  });
  await refused(res, 503, "not_configured");
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(n, 0);
});

it("no usable APP_BASE_URL means 503, never a relative return address", async () => {
  const classId = await newClass({});
  await refused(
    await post(form(await classCode(classId)), {
      env: { ...ENV, APP_BASE_URL: "lead.test" },
    }),
    503,
    "not_configured",
  );
});

it("a provider failure leaves the reservation to expire and says so", async () => {
  const classId = await newClass({});
  const res = await post(form(await classCode(classId)), {
    checkout: async () => ({ kind: "failed", detail: "api_error/rate_limit" }),
  });
  assert.equal(res.status, 500);
  // The seat stands: it frees itself in 24 hours (§12.1), and a retry reuses
  // the same reservation and the same idempotency key.
  const [e] = await db()`
    SELECT status FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(e.status, "reserved");
  const [d] = await db()`
    SELECT checkout_url FROM deal WHERE source_touchpoint_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1`;
  assert.equal(
    d.checkout_url,
    null,
    "no link is stored for a session we never got",
  );
});

// ---- The capture, unchanged from §8.2 -------------------------------------

it("a registration captures the touchpoint, the consent and the deal", async () => {
  const classId = await newClass({});
  const out = await created(
    await post(
      form(await classCode(classId), {
        consentMarketing: true,
        companyName: "Acme Sdn Bhd",
        message: "Can I pay by FPX?",
        attribution: {
          utmSource: "facebook",
          utmCampaign: "agentic_202610",
          landingUrl: "https://thelead.io/lp/agentic?email=leak@example.com",
        },
      }),
    ),
  );
  const [t] = await db()`
    SELECT utm_source, utm_campaign, landing_url, is_first_touch, channel
    FROM touchpoint WHERE person_id = ${out.personId}`;
  assert.equal(t.utm_source, "facebook");
  assert.equal(t.channel, "web_form");
  assert.equal(t.is_first_touch, true);
  // O14: the stripped URL, so a query string cannot smuggle personal data in.
  assert.ok(!String(t.landing_url).includes("leak@example.com"));

  const consents = await db()`
    SELECT purpose FROM consent WHERE person_id = ${out.personId} ORDER BY purpose`;
  assert.deepEqual(
    consents.map((c) => c.purpose),
    ["marketing_email", "marketing_whatsapp"],
  );
  const [{ n: captured }] = await db()`
    SELECT count(*)::int AS n FROM event_outbox
    WHERE type = 'LeadCaptured' AND aggregate_id = ${out.personId}`;
  assert.equal(captured, 1);
  const [p] = await db()`
    SELECT notes, company_name_given FROM person WHERE id = ${out.personId}`;
  assert.match(String(p.notes), /Can I pay by FPX\?/);
  assert.equal(p.company_name_given, "Acme Sdn Bhd");
});

it("a soft duplicate still raises the §7.1 pair task", async () => {
  const classId = await newClass({});
  const phone = uniquePhone();
  const existing = await newPerson("Tan Mei Ling", phone);
  await db()`
    UPDATE person SET phone_e164 = ${normalizePhoneE164(phone)} WHERE id = ${existing}`;
  const out = await created(
    await post(
      // Same normalised name, last 7 digits of the phone match: a soft match,
      // so the person is created and flagged (§12.2 rule 3).
      form(await classCode(classId), {
        fullName: "TAN MEI-LING",
        phone: `011${phone.slice(3)}`,
        email: undefined,
      }),
    ),
  );
  const [p] = await db()`
    SELECT needs_review, needs_review_reason FROM person WHERE id = ${out.personId}`;
  assert.equal(p.needs_review, true);
  assert.equal(p.needs_review_reason, "possible_duplicate_phone");
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM task
    WHERE type = 'review_duplicate' AND person_id = ${out.personId}
      AND related_person_id = ${existing} AND done_at IS NULL`;
  assert.equal(n, 1);
});

it("an unnormalisable phone is kept, flagged, and still registered", async () => {
  const classId = await newClass({});
  const out = await created(
    await post(
      form(await classCode(classId), { phone: "12345", email: undefined }),
    ),
  );
  const [p] = await db()`
    SELECT phone, phone_e164, needs_review_reason FROM person WHERE id = ${out.personId}`;
  assert.equal(p.phone, "12345");
  assert.equal(p.phone_e164, null);
  assert.equal(p.needs_review_reason, "phone_unnormalised");
  assert.equal(out.next, "checkout");
});

// ---- A replayed key (§8.2 step 8) -----------------------------------------

it("a replayed key answers with the same payment page and reserves nothing new", async () => {
  const classId = await newClass({ capacity: 5 });
  const body = form(await classCode(classId));
  const stripe = fakeCheckout();
  const first = await created(await post(body, { checkout: stripe.port }));
  const again = await created(await post(body, { checkout: stripe.port }));
  assert.deepEqual(
    { ...again, next: again.next },
    { ...first, next: first.next },
    "same ids, same page",
  );
  assert.equal(stripe.calls.length, 1, "the provider is not called twice");
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM enrolment WHERE class_id = ${classId}`;
  assert.equal(n, 1);
});

it("a replayed HRDC key answers with the HRDC outcome again", async () => {
  const classId = await newClass({});
  const body = form(await classCode(classId), { hrdcIntended: true });
  const first = await created(await post(body));
  const again = await created(await post(body));
  assert.equal(again.next, "hrdc_contact");
  assert.equal(again.personId, first.personId);
  assert.equal(again.dealId, first.dealId);
});

// ---- Two people, one last seat (§14, §12.1) -------------------------------

test(
  "two registrations for the last seat produce exactly one reservation",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    // §14 and §15.2 require this one automatically, and a race needs two real
    // transactions that can see each other, so it commits and cleans up after
    // itself — through the replica role, as `purgeLead` in
    // tests/public-api-db.test.ts does, because the rows involved are
    // append-only to the application (§12.11: an enrolment is cancelled,
    // never deleted).
    const classId = await newClass({ capacity: 1 });
    const code = await classCode(classId);
    try {
      const [a, b] = await Promise.all([
        post(form(code), { checkout: fakeCheckout().port }),
        post(form(code), { checkout: fakeCheckout().port }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409], "one of each");
      const loser = a.status === 409 ? a : b;
      assert.equal(
        ((await loser.json()) as { error: { code: string } }).error.code,
        "no_seats",
      );
      const seats = await db()`
        SELECT person_id FROM enrolment WHERE class_id = ${classId}`;
      assert.equal(seats.length, 1, "exactly one seat was taken");
      const won = (await (a.status === 201 ? a : b).json()) as {
        personId: string;
      };
      assert.equal(seats[0].person_id, won.personId);
    } finally {
      await purgeClassAndLeads(classId);
    }
  },
);

// Removes everything the committed test wrote. The append-only tables and the
// enrolment's history need the replica role, as purge.ts and
// tests/public-api-db.test.ts's own cleanup do.
async function purgeClassAndLeads(classId: string) {
  const people = await db()`
    SELECT DISTINCT d.person_id FROM deal d
    LEFT JOIN enrolment e ON e.deal_id = d.id
    WHERE e.class_id = ${classId} OR d.class_id = ${classId}`;
  await db().begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM enrolment_status_history WHERE enrolment_id IN (
      SELECT id FROM enrolment WHERE class_id = ${classId})`;
    await tx`DELETE FROM enrolment WHERE class_id = ${classId}`;
    for (const { person_id } of people) {
      const id = person_id as string;
      await tx`DELETE FROM task WHERE person_id = ${id} OR related_person_id = ${id}`;
      await tx`DELETE FROM event_outbox WHERE aggregate_id IN (
        SELECT id FROM deal WHERE person_id = ${id})`;
      await tx`DELETE FROM event_outbox WHERE aggregate_id = ${id}`;
      await tx`DELETE FROM audit_log WHERE entity_id = ${id}`;
      await tx`DELETE FROM consent WHERE person_id = ${id}`;
      await tx`DELETE FROM deal WHERE person_id = ${id}`;
      await tx`DELETE FROM touchpoint WHERE person_id = ${id}`;
      await tx`DELETE FROM person WHERE id = ${id}`;
    }
    const [cls] = await tx`SELECT course_id FROM class WHERE id = ${classId}`;
    await tx`DELETE FROM event_outbox WHERE aggregate_id = ${classId}`;
    await tx`DELETE FROM class WHERE id = ${classId}`;
    if (cls) await tx`DELETE FROM course WHERE id = ${cls.course_id}`;
  });
  await db()`DELETE FROM rate_limit_hit`;
}

// ---- The route file (§8.3) -------------------------------------------------

test("the route is a one-liner over the handler, like the other two", () => {
  // Read, not imported: the route uses the "@/" alias, which only the bundler
  // resolves. tests/public-schedule.test.ts reads proxy.ts the same way.
  const src = readFileSync(
    new URL("../app/api/public/register/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /export const POST = \(request: Request\) => handleRegister\(request\);/,
  );
  assert.match(
    src,
    /export const OPTIONS = \(request: Request\) => handleOptions\(request\);/,
  );
  // No rule of its own: everything lives in lib/public so tests can call it.
  const code = src
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("//"));
  assert.equal(code.length, 3, code.join(" | "));
});
