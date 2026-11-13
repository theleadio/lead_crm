import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mayUseInbox } from "@/lib/inbox/service";
import { sendInboxTemplate, TEMPLATE_NAME, watiFromEnv } from "@/lib/wati/send";

const bodySchema = z.object({
  template: z
    .string()
    .trim()
    .regex(TEMPLATE_NAME, "Lowercase letters, digits and _, as in WATI"),
  params: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        value: z.string().trim().max(1000),
      }),
    )
    .max(20)
    .default([]),
});

// POST /api/conversations/:id/template — an approved WATI template from the
// inbox, for when the free-reply window has closed (lib/wati/send.ts).
// 503 until WATI_API_HOST and WATI_API_TOKEN are set.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/conversations/[id]/template">,
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
  const r = await sendInboxTemplate(
    wati,
    viewer,
    id,
    parsed.data.template,
    parsed.data.params,
  );
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
      return apiError(422, "invalid", r.message, {
        fields: { template: r.message },
      });
    case "busy":
      return apiError(
        429,
        "busy",
        "WATI is busy right now, so it wasn't sent. Wait a minute and send it again.",
      );
    case "send_failed":
      return apiError(
        422,
        "send_failed",
        "WATI refused the template. Check the name, that it is approved, and its parameters.",
      );
    case "unknown":
      return apiError(
        502,
        "unknown",
        "WATI didn't answer clearly, so the template may have gone out. Check the chat in WATI before sending it again.",
      );
  }
}
