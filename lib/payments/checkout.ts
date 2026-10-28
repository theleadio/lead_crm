import type { Env } from "../public/guard.ts";

// The Stripe Checkout session (§8.3 step 4, §7.1's checkout-link route).
//
// §8.3 calls the session creation Shawn's code. Decided 26 Oct: it is built
// here behind one function so §10.4 is not blocked, and the same function
// serves his `POST /api/deals/:id/checkout-link` — which is why the input
// below knows nothing about a form, a visitor or a locale. Replacing this
// implementation is one file and one injected value (`PublicDeps.checkout`).
//
// Stripe's REST API over `fetch`, not the `stripe` package: one call does not
// earn a dependency, and the SDK's real value — webhook signature
// verification — lands on the webhook, which is his.

export type CheckoutInput = {
  dealId: string;
  enrolmentId: string;
  classId: string;
  // As the database gives it: numeric(12,2) as a string ("3200.00"). Never a
  // float — §4, and a rounding error here is money.
  amountMyr: string;
  productName: string;
  // The reservation's hold (§12.1). Stripe gets the same moment, so the seat
  // and the payment page die together.
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { kind: "ok"; id: string; url: string }
  // No secret: the route answers 503 rather than reserving a seat nobody can
  // pay for. Never a silent non-payment.
  | { kind: "not_configured" }
  // `detail` is Stripe's error type and code, or an error name. Never a body,
  // a key or a URL (§13: never log a secret).
  | { kind: "failed"; detail: string };

export type CheckoutPort = (input: CheckoutInput) => Promise<CheckoutResult>;

const SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

// Stripe accepts an expiry between 30 minutes and 24 hours ahead. The hold is
// 24 hours (`stripe_reservation_hours`, migration 006), so a normal
// reservation lands inside the window; a setting someone raises would not,
// and a clamped session beats a refused booking.
// Exported because §8.3's reservation rule has to agree with it: a hold with
// less than this left cannot carry a session, since the clamp would push the
// payment page past the seat.
export const MIN_EXPIRY_MS = 30 * 60 * 1000;
const MIN_MS = MIN_EXPIRY_MS;
const MAX_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export function secretKey(env: Env): string | null {
  return (env.STRIPE_SECRET_KEY ?? "").trim() || null;
}

// The site's own root, for the absolute addresses Stripe demands. Server
// configuration only: a request's Host, Origin or forwarded header could be
// spoofed, and a payer would be returned to someone else's site.
export function appBase(env: Env): string | null {
  const raw = (env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

// The one answer to "can a payment complete here", read by the §8.3 route for
// its 503 and by the §10.1 cards for whether to offer registration at all. A
// card can therefore never invite a visitor into a path that ends in 503.
export function checkoutConfigured(env: Env): boolean {
  return secretKey(env) !== null && appBase(env) !== null;
}

// numeric(12,2) as a string to integer sen. String arithmetic, so 3200.05
// never becomes 320004.99999. Returns null for anything that is not an
// amount, which is a programming error rather than a visitor's input: the
// caller refuses the booking instead of charging a guess.
export function senFromMyr(amount: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  const sen = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(sen) && sen > 0 ? sen : null;
}

function clampExpiry(expiresAt: Date, now = Date.now()): number {
  const want = expiresAt.getTime();
  const capped = Math.min(Math.max(want, now + MIN_MS), now + MAX_MS);
  if (capped !== want)
    console.warn(
      "checkout expiry clamped to Stripe's window",
      Math.round((want - now) / 60000),
      "min requested",
    );
  return Math.floor(capped / 1000);
}

export function sessionBody(
  input: CheckoutInput,
  sen: number,
): URLSearchParams {
  const body = new URLSearchParams({
    mode: "payment",
    expires_at: String(clampExpiry(input.expiresAt)),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // The webhook looks a payment up by what it carries (§11.2). These three
    // names are the contract with Shawn's webhook — renaming one here makes
    // every payment unmatchable, so they are asserted in the tests.
    "metadata[deal_id]": input.dealId,
    "metadata[enrolment_id]": input.enrolmentId,
    "metadata[class_id]": input.classId,
    client_reference_id: input.enrolmentId,
    "line_items[0][quantity]": "1",
    // MYR only (§4). The amount is the class's, read on the server.
    "line_items[0][price_data][currency]": "myr",
    "line_items[0][price_data][unit_amount]": String(sen),
    "line_items[0][price_data][product_data][name]": input.productName,
  });
  return body;
}

// One key per reservation, not per submission: a retry for the same seat must
// return the same payment page, and a client-chosen key must not be able to
// collide across two enrolments.
export const idempotencyKey = (enrolmentId: string) =>
  `enrolment:${enrolmentId}`;

export function stripeCheckout(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): CheckoutPort {
  return async (input) => {
    const secret = secretKey(env);
    if (!secret) return { kind: "not_configured" };
    const sen = senFromMyr(input.amountMyr);
    if (sen === null) return { kind: "failed", detail: "bad_amount" };
    try {
      const res = await fetchImpl(SESSIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": idempotencyKey(input.enrolmentId),
        },
        body: sessionBody(input, sen),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => null)) as {
        id?: string;
        url?: string;
        error?: { type?: string; code?: string };
      } | null;
      if (!res.ok || !json?.id || !json.url)
        return {
          kind: "failed",
          detail: `${json?.error?.type ?? res.status}/${json?.error?.code ?? "no_session"}`,
        };
      return { kind: "ok", id: json.id, url: json.url };
    } catch (err) {
      // A timeout arrives here as TimeoutError. The reservation stands and
      // expires on its own; a retry reuses the idempotency key above.
      return { kind: "failed", detail: (err as Error).name || "fetch_failed" };
    }
  };
}
