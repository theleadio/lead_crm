import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe-Signature check (spec §14), done by hand so the app needs no Stripe
// SDK. Header: `t=<unix>,v1=<hex>[,v1=<hex>...]`, where v1 is the HMAC-SHA256
// of `<t>.<raw body>` keyed with the endpoint secret. Several v1 values appear
// while a secret is being rolled; any one matching is enough.

export const TOLERANCE_SECONDS = 300; // replay window, both directions

// A real whsec_ secret is about 38 characters. Shorter means "not configured".
export const MIN_SECRET_LENGTH = 16;

export function secretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secretConfigured(secret)) return false;
  let t = "";
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") candidates.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || candidates.length === 0) return false;
  if (Math.abs(nowSeconds - Number(t)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest();
  let ok = false;
  for (const c of candidates) {
    if (!/^[0-9a-f]{64}$/i.test(c)) continue;
    // No early exit: every candidate is compared in constant time.
    if (timingSafeEqual(expected, Buffer.from(c, "hex"))) ok = true;
  }
  return ok;
}
