// The one outbound Stripe call this side makes (spec O36): expire an open
// Checkout session when its class is cancelled. Plain fetch, no SDK. With no
// STRIPE_SECRET_KEY it does nothing, so a database without Stripe still works.

type Env = Record<string, string | undefined>;

export async function expireCheckoutSession(
  sessionId: string,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return;
  // The id goes into a URL path: refuse anything that is not a session id.
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId))
    throw new Error("not a Checkout session id");
  const res = await fetchFn(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (res.ok) return;
  // A handler can run twice, and a customer may have paid meanwhile: Stripe
  // answers 400 "only sessions with status open can be expired". The goal
  // (no open link) is met, so that is success.
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (/expired|complete|status/i.test(body?.error?.message ?? "")) return;
  }
  throw new Error(`stripe expire failed: HTTP ${res.status}`);
}
