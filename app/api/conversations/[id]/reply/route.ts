import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mayUseInbox } from "@/lib/inbox/service";
import { sendInboxReply, watiFromEnv } from "@/lib/wati/send";

const bodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Write the reply first")
    .max(4000, "Keep it under 4,000 characters"),
});

// POST /api/conversations/:id/reply — a WhatsApp reply from the inbox,
// through WATI (lib/wati/send.ts). Free text inside the 24-hour window only.
// 503 until WATI_API_HOST and WATI_API_TOKEN are set.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/conversations/[id]/reply">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!(await mayUseInbox(viewer)))
    return forbidden(viewer, request, {
      what: "the inbox",
      resource: "conversation",
    });
  const wati = watiFromEnv();
  if (!wati)
    return apiError(503, "not_configured", "WhatsApp sending isn't set up.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;
  const r = await sendInboxReply(wati, viewer, id, parsed.data.text);
  switch (r.kind) {
    case "sent":
      return new Response(null, { status: 204 });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This WhatsApp conversation doesn't exist, or isn't one you can see.",
      );
    case "invalid":
      return apiError(422, "invalid", r.message);
    case "send_failed":
      return apiError(
        502,
        "send_failed",
        "WhatsApp did not accept the message. Try again, or check the WATI connection.",
      );
  }
}
