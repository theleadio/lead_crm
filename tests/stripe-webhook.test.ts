// The Stripe-Signature check (lib/payments/stripe-webhook.ts), without a
// database. Signatures here are built the way Stripe's official library
// builds them (`Webhooks.js`: HMAC-SHA256 hex of "<t>.<raw body>").
import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  SIGNATURE_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from "../lib/payments/stripe-webhook.ts";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';
const NOW = 1_800_000_000;

const sign = (t: number, body = BODY, secret = SECRET) =>
  createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

test("accepts a header Stripe would send", () => {
  assert.equal(
    verifyStripeSignature(BODY, `t=${NOW},v1=${sign(NOW)}`, SECRET, NOW),
    true,
  );
});

test("accepts when any one of several v1 signatures matches (secret roll)", () => {
  const header = `t=${NOW},v1=${sign(NOW, BODY, "whsec_old")},v1=${sign(NOW)}`;
  assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW), true);
});

test("refuses a changed body", () => {
  assert.equal(
    verifyStripeSignature(`${BODY} `, `t=${NOW},v1=${sign(NOW)}`, SECRET, NOW),
    false,
  );
});

test("refuses the wrong secret", () => {
  assert.equal(
    verifyStripeSignature(
      BODY,
      `t=${NOW},v1=${sign(NOW, BODY, "whsec_x")}`,
      SECRET,
      NOW,
    ),
    false,
  );
});

test("refuses an old timestamp (replay), at Stripe's 300 s default", () => {
  const t = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
  assert.equal(
    verifyStripeSignature(BODY, `t=${t},v1=${sign(t)}`, SECRET, NOW),
    false,
  );
  const ok = NOW - SIGNATURE_TOLERANCE_SECONDS;
  assert.equal(
    verifyStripeSignature(BODY, `t=${ok},v1=${sign(ok)}`, SECRET, NOW),
    true,
  );
});

test("refuses a missing or malformed header", () => {
  for (const header of [
    null,
    "",
    "garbage",
    `t=${NOW}`,
    `v1=${sign(NOW)}`,
    `t=x,v1=${sign(NOW)}`,
  ])
    assert.equal(
      verifyStripeSignature(BODY, header, SECRET, NOW),
      false,
      String(header),
    );
});

test("refuses other schemes (v0) and non-hex junk without throwing", () => {
  assert.equal(
    verifyStripeSignature(BODY, `t=${NOW},v0=${sign(NOW)}`, SECRET, NOW),
    false,
  );
  assert.equal(
    verifyStripeSignature(BODY, `t=${NOW},v1=zz`, SECRET, NOW),
    false,
  );
});

test("refuses when no secret is configured", () => {
  assert.equal(
    verifyStripeSignature(BODY, `t=${NOW},v1=${sign(NOW)}`, "", NOW),
    false,
  );
});
