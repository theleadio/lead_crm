import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import { processLmsEvent, verifyLmsSignature } from "@/lib/lms/receive";

// POST /api/webhooks/lms — the LMS reports attendance and completion
// (handoff spec §4.6). Signed with LMS_WEBHOOK_SECRET over the raw body.
//   200  applied, or a repeat
//   400  bad body or invalid data (not retried usefully)
//   401  bad signature or clock skew
//   404  no such enrolment
//   409  out of order (e.g. completed before attended): retry later
export async function POST(request: NextRequest) {
  const secret = (process.env.LMS_WEBHOOK_SECRET ?? "").trim();
  if (!secret)
    return apiError(503, "not_configured", "LMS webhook is not configured.");
  const raw = await request.text();
  if (
    !verifyLmsSignature(
      raw,
      request.headers.get("x-lead-timestamp"),
      request.headers.get("x-lead-signature"),
      secret,
    )
  )
    return apiError(401, "bad_signature", "Signature check failed.");

  let event: { messageId: string; type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
    if (
      typeof event?.messageId !== "string" ||
      !event.messageId.trim() ||
      event.messageId.length > 200 ||
      typeof event.type !== "string" ||
      !event.data ||
      typeof event.data !== "object"
    )
      throw new Error("not a notice");
  } catch {
    return apiError(400, "bad_body", "Not an LMS notice.");
  }

  try {
    const r = await processLmsEvent(event);
    switch (r.kind) {
      case "applied":
      case "duplicate":
      case "ignored":
        return Response.json({ received: true, result: r.kind });
      case "not_found":
        return apiError(404, "not_found", "No such enrolment.");
      case "out_of_order":
        return apiError(
          409,
          "out_of_order",
          `Enrolment is ${r.from}; send the earlier step first.`,
        );
      case "invalid":
        return apiError(400, "invalid", r.reason);
    }
  } catch (e) {
    console.error(
      `lms webhook ${event.messageId} (${event.type}) failed:`,
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "processing_failed", "Will be retried.");
  }
}
