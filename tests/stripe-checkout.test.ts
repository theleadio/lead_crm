// The Stripe Checkout port (§8.3 step 4, lib/payments/checkout.ts). No
// network: every test passes its own fetch. What is asserted here is the
// handshake Shawn's webhook depends on — the three metadata names above all —
// plus the money conversion, the expiry window and what reaches a log line.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  appBase,
  checkoutConfigured,
  idempotencyKey,
  senFromMyr,
  sessionBody,
  createCheckoutSession,
  type CheckoutInput,
} from "../lib/payments/checkout.ts";

const HOUR = 60 * 60 * 1000;

const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  dealId: "d-1",
  enrolmentId: "e-1",
  classId: "c-1",
  amountMyr: "3200.00",
  productName: "AI Agentic Automation (AIA-2610-EN)",
  expiresAt: new Date(Date.now() + 23 * HOUR),
  successUrl:
    "https://lead.test/register/thank-you?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://lead.test/register/AIA-2610-EN",
  ...over,
});

// A fake Stripe. Records the one call it is given and answers like the API.
function fakeStripe(answer: { status?: number; body?: unknown } = {}): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify(
        answer.body ?? { id: "cs_test_1", url: "https://pay.test/s" },
      ),
      {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const fields = (init: RequestInit) =>
  new URLSearchParams(String(init.body as URLSearchParams));

test("MYR is converted to integer sen without touching a float", () => {
  assert.equal(senFromMyr("3200.00"), 320000);
  assert.equal(senFromMyr("3200.05"), 320005);
  assert.equal(senFromMyr("3200.5"), 320050);
  assert.equal(senFromMyr("3200"), 320000);
  assert.equal(senFromMyr(" 99.99 "), 9999);
  // Not an amount, or nothing to charge: the caller refuses the booking
  // rather than charging a guess.
  assert.equal(senFromMyr("0.00"), null);
  assert.equal(senFromMyr("-5.00"), null);
  assert.equal(senFromMyr("3,200.00"), null);
  assert.equal(senFromMyr("abc"), null);
  assert.equal(senFromMyr(""), null);
});

test("the session carries the three metadata names the webhook reads", () => {
  const body = fields({ body: sessionBody(input(), 320000) });
  assert.equal(body.get("metadata[deal_id]"), "d-1");
  assert.equal(body.get("metadata[enrolment_id]"), "e-1");
  assert.equal(body.get("metadata[class_id]"), "c-1");
  // The enrolment again, where Stripe's own dashboard shows it.
  assert.equal(body.get("client_reference_id"), "e-1");
});

test("the amount and currency are the class's, in MYR", () => {
  const body = fields({ body: sessionBody(input(), 320000) });
  assert.equal(body.get("line_items[0][price_data][currency]"), "myr");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "320000");
  assert.equal(body.get("line_items[0][quantity]"), "1");
  assert.equal(body.get("mode"), "payment");
});

test("the expiry is the reservation's hold, in seconds", () => {
  const expiresAt = new Date(Date.now() + 23 * HOUR);
  const body = fields({ body: sessionBody(input({ expiresAt }), 320000) });
  assert.equal(
    Number(body.get("expires_at")),
    Math.floor(expiresAt.getTime() / 1000),
  );
});

test("a hold beyond Stripe's 24 hours is clamped, and the clamp is logged", () => {
  const warn = mock.method(console, "warn", () => {});
  const body = fields({
    body: sessionBody(
      input({ expiresAt: new Date(Date.now() + 48 * HOUR) }),
      1,
    ),
  });
  const seconds = Number(body.get("expires_at"));
  assert.ok(seconds <= Math.floor((Date.now() + 24 * HOUR) / 1000));
  assert.ok(seconds > Math.floor((Date.now() + 23 * HOUR) / 1000));
  assert.equal(warn.mock.callCount(), 1);
  warn.mock.restore();
});

test("a hold inside half an hour is raised to Stripe's minimum", () => {
  const warn = mock.method(console, "warn", () => {});
  const body = fields({
    body: sessionBody(input({ expiresAt: new Date(Date.now() + 60_000) }), 1),
  });
  assert.ok(
    Number(body.get("expires_at")) >=
      Math.floor((Date.now() + 29 * 60_000) / 1000),
  );
  warn.mock.restore();
});

test("one idempotency key per reservation, not per submission", async () => {
  const stripe = fakeStripe();
  const port = createCheckoutSession(
    { STRIPE_SECRET_KEY: "sk_test_x" },
    stripe.fetch,
  );
  await port(input());
  await port(input());
  const keys = stripe.calls.map(
    (c) => (c.init.headers as Record<string, string>)["idempotency-key"],
  );
  assert.deepEqual(keys, ["enrolment:e-1", "enrolment:e-1"]);
  assert.equal(idempotencyKey("e-9"), "enrolment:e-9");
});

test("the call carries the secret as a bearer token and a timeout", async () => {
  const stripe = fakeStripe();
  const port = createCheckoutSession(
    { STRIPE_SECRET_KEY: "sk_test_x" },
    stripe.fetch,
  );
  const result = await port(input());
  assert.deepEqual(result, {
    kind: "ok",
    id: "cs_test_1",
    url: "https://pay.test/s",
  });
  const { url, init } = stripe.calls[0];
  assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(
    (init.headers as Record<string, string>).authorization,
    "Bearer sk_test_x",
  );
  // A hung provider must fail the submission rather than hold the request
  // open; AbortSignal.timeout is what does it.
  assert.ok(init.signal instanceof AbortSignal);
});

test("no secret reports not configured instead of throwing", async () => {
  const stripe = fakeStripe();
  const port = createCheckoutSession({}, stripe.fetch);
  assert.deepEqual(await port(input()), { kind: "not_configured" });
  assert.equal(stripe.calls.length, 0, "nothing is sent without a key");
});

test("a provider failure logs its type and code, never the key or the URL", async () => {
  const stripe = fakeStripe({
    status: 402,
    body: { error: { type: "card_error", code: "card_declined" } },
  });
  const port = createCheckoutSession(
    { STRIPE_SECRET_KEY: "sk_test_secret" },
    stripe.fetch,
  );
  const result = await port(input());
  assert.deepEqual(result, {
    kind: "failed",
    detail: "card_error/card_declined",
  });
  // The detail is what the caller logs (lib/public/register.ts), so it is the
  // whole of what can reach a log line.
  const detail = result.kind === "failed" ? result.detail : "";
  assert.ok(!detail.includes("sk_test_secret"));
  assert.ok(!detail.includes("pay.test"));
  assert.ok(!detail.includes("3200"));
});

test("a timeout is a failure named by the error, not a thrown request", async () => {
  const f = (async () => {
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  }) as unknown as typeof fetch;
  const port = createCheckoutSession({ STRIPE_SECRET_KEY: "sk_test_x" }, f);
  assert.deepEqual(await port(input()), {
    kind: "failed",
    detail: "TimeoutError",
  });
});

test("an amount that is not an amount never reaches the provider", async () => {
  const stripe = fakeStripe();
  const port = createCheckoutSession(
    { STRIPE_SECRET_KEY: "sk_test_x" },
    stripe.fetch,
  );
  assert.deepEqual(await port(input({ amountMyr: "0.00" })), {
    kind: "failed",
    detail: "bad_amount",
  });
  assert.equal(stripe.calls.length, 0);
});

test("configured means the secret and an absolute base, together", () => {
  const key = "sk_test_x";
  assert.equal(checkoutConfigured({}), false);
  assert.equal(checkoutConfigured({ STRIPE_SECRET_KEY: "  " }), false, "blank");
  assert.equal(
    checkoutConfigured({ STRIPE_SECRET_KEY: key }),
    false,
    "no base: Stripe refuses a relative return address",
  );
  assert.equal(
    checkoutConfigured({ STRIPE_SECRET_KEY: key, APP_BASE_URL: "/lead" }),
    false,
    "not absolute",
  );
  assert.equal(
    checkoutConfigured({
      STRIPE_SECRET_KEY: key,
      APP_BASE_URL: "https://lead.test",
    }),
    true,
  );
});

test("the base is an origin, with any path or trailing slash dropped", () => {
  assert.equal(
    appBase({ APP_BASE_URL: "https://lead.test/" }),
    "https://lead.test",
  );
  assert.equal(
    appBase({ APP_BASE_URL: "http://localhost:3000" }),
    "http://localhost:3000",
  );
  assert.equal(appBase({ APP_BASE_URL: "lead.test" }), null);
  assert.equal(appBase({}), null);
});
