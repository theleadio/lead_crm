import { handleStripeWebhook } from "@/lib/integrations/stripe-webhook";

// POST /api/webhooks/stripe — spec §7, §14. No session: the Stripe-Signature
// header is checked in lib/integrations. Other methods get Next's 405.
export const POST = (request: Request) => handleStripeWebhook(request);
