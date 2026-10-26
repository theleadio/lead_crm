import { reduceEvent, type ReducedEvent } from "./stripe-reduce.ts";
import { secretConfigured, verifyStripeSignature } from "./stripe-signature.ts";
import { processStripeEvents, stageStripeEvent } from "./stripe.ts";

// POST /api/webhooks/stripe (spec §7, §14). No session; the signature is the
// credential. The route file is a one-liner over this so tests can call it
// with a fake env, as with lib/public/handlers.ts.

export const MAX_BODY_BYTES = 256 * 1024;

export type StripeWebhookDeps = {
  env: Record<string, string | undefined>;
  now?: () => number; // unix seconds, for the replay window
};

// Status only, no body: a caller learns nothing from a refusal.
const reply = (status: number, body?: unknown) =>
  body === undefined
    ? new Response(null, { status, headers: { "Cache-Control": "no-store" } })
    : Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
      });

// Reads the raw bytes, stopping as soon as the cap is passed.
async function readCapped(request: Request): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const errName = (err: unknown) =>
  `${(err as { name?: string }).name}:${(err as { code?: string }).code ?? ""}`;

export async function handleStripeWebhook(
  request: Request,
  d: StripeWebhookDeps = { env: process.env },
): Promise<Response> {
  const secret = d.env.STRIPE_WEBHOOK_SECRET;
  // Fail closed: no usable secret, nothing is read, let alone processed.
  if (!secretConfigured(secret)) return reply(503);

  const raw = await readCapped(request);
  if (!raw) return reply(413);

  const now = d.now ? d.now() : Math.floor(Date.now() / 1000);
  if (
    !verifyStripeSignature(
      raw,
      request.headers.get("stripe-signature"),
      secret,
      now,
    )
  )
    return reply(400);

  let event: ReducedEvent | null;
  try {
    event = reduceEvent(JSON.parse(raw.toString("utf8")));
  } catch {
    event = null;
  }
  if (!event) return reply(400);

  try {
    const rowId = await stageStripeEvent(event);
    // A replay or an ignored type is done: 200 so Stripe stops retrying.
    if (rowId) {
      try {
        await processStripeEvents({ ids: [rowId] });
      } catch (err) {
        // Best effort: the row stays 'received' and the scheduled job retries.
        console.error("stripe inline process failed", event.id, errName(err));
      }
    }
    console.info(
      "stripe webhook",
      event.id,
      event.type,
      rowId ? "stored" : "skipped",
    );
    return reply(200, { received: true });
  } catch (err) {
    // Could not even store it: 500 makes Stripe retry later.
    console.error("stripe webhook store failed", event.id, errName(err));
    return reply(500);
  }
}
