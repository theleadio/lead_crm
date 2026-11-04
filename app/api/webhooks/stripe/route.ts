import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import { secretKey } from "@/lib/payments/checkout";
import {
  processStripeEvent,
  verifyStripeSignature,
  type StripeEvent,
} from "@/lib/payments/stripe-webhook";

// POST /api/webhooks/stripe — §11.3, the §15.2 go-live gate. Stripe signs
// every delivery with STRIPE_WEBHOOK_SECRET; nothing else authenticates it,
// so the proxy skips /api/webhooks (proxy.ts) and the signature is checked
// first, against the raw body (it must not be re-serialised before checking).
//
// Answers: 2xx when the event is handled, ignored or already seen, so Stripe
// stops sending it; 400 for a bad signature or body; 5xx when processing
// failed, so Stripe retries later (`integration_event` lets the retry run).
// Logs carry the event id and error message only, never the payload: it holds
// the customer's name and email.
export async function POST(request: NextRequest) {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret)
    return apiError(503, "not_configured", "Stripe webhook is not configured.");

  const raw = await request.text();
  if (
    !verifyStripeSignature(
      raw,
      request.headers.get("stripe-signature"),
      webhookSecret,
    )
  )
    return apiError(400, "bad_signature", "Signature check failed.");

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
    if (!event?.id || !event.type || !event.data?.object)
      throw new Error("not an event");
  } catch {
    return apiError(400, "bad_body", "Not a Stripe event.");
  }

  try {
    const result = await processStripeEvent(event, {
      secretKey: secretKey(process.env),
    });
    return Response.json({ received: true, result: result.kind });
  } catch (e) {
    console.error(
      `stripe webhook ${event.id} (${event.type}) failed:`,
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "processing_failed", "Will be retried.");
  }
}
