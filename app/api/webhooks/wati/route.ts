import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import {
  eventKey,
  processWatiEvent,
  recordWatiEvent,
  verifyWatiToken,
} from "@/lib/wati/webhook";

// WATI webhook (lib/wati/webhook.ts). WATI documents no signature, so the
// address WATI is given carries a long random secret:
//   https://<host>/api/webhooks/wati?token=<WATI_WEBHOOK_SECRET>
// An event is recorded before anything else; once it is, the answer is 200
// even if processing failed, because `npm run wati:run` (every 5 minutes) tries it again. A 5xx
// only when it could not be recorded, so WATI sends it again.
export async function POST(request: NextRequest) {
  const secret = (process.env.WATI_WEBHOOK_SECRET ?? "").trim();
  if (!secret)
    return apiError(503, "not_configured", "WATI webhook is not configured.");
  const given =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("x-wati-token");
  if (!verifyWatiToken(given, secret))
    return apiError(401, "bad_token", "Token check failed.");

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return apiError(400, "bad_body", "Not JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return apiError(400, "bad_body", "Expected one event.");
  const event = body as Record<string, unknown>;
  const key = eventKey(event);
  if (!key) return apiError(400, "bad_body", "No event type or message id.");

  try {
    await recordWatiEvent(key, event);
  } catch (e) {
    console.error(
      "wati webhook: could not record event:",
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "processing_failed", "Will be retried.");
  }
  try {
    await processWatiEvent(key);
  } catch (e) {
    // Logged by key only: an event carries a phone number and message text.
    console.error(
      `wati webhook: ${key} not processed:`,
      e instanceof Error ? e.message : String(e),
    );
  }
  return Response.json({ ok: true });
}
