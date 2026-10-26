// expireCheckoutSession (spec O36) against a fake fetch: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expireCheckoutSession } from "../lib/integrations/stripe-api.ts";

const key = { STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(20) };
const fake = (status: number, body: unknown = {}) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
};

test("no key: does nothing and never calls fetch", async () => {
  const { f, calls } = fake(200);
  await expireCheckoutSession("cs_test_1", {}, f);
  assert.equal(calls.length, 0);
});

test("posts to the expire URL with a bearer key and a timeout signal", async () => {
  const { f, calls } = fake(200);
  await expireCheckoutSession("cs_test_1", key, f);
  assert.equal(
    calls[0].url,
    "https://api.stripe.com/v1/checkout/sessions/cs_test_1/expire",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, {
    Authorization: `Bearer ${key.STRIPE_SECRET_KEY}`,
  });
  assert.ok(calls[0].init.signal);
});

test("already expired or completed counts as success; other errors throw", async () => {
  const msg = "Only Checkout Sessions with a status of `open` can be expired.";
  await expireCheckoutSession(
    "cs_test_1",
    key,
    fake(400, { error: { message: msg } }).f,
  );
  await assert.rejects(
    expireCheckoutSession(
      "cs_test_1",
      key,
      fake(400, { error: { message: "bad" } }).f,
    ),
  );
  await assert.rejects(expireCheckoutSession("cs_test_1", key, fake(500).f));
  await assert.rejects(expireCheckoutSession("cs_test_1", key, fake(401).f));
});

test("a non-session id never reaches the URL", async () => {
  const { f, calls } = fake(200);
  await assert.rejects(expireCheckoutSession("../customers", key, f));
  assert.equal(calls.length, 0);
});
