import type { NextRequest } from "next/server";
import { apiError, forbidden } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { openPersonWhatsapp } from "@/lib/inbox/service";

// POST /api/people/:id/whatsapp — the person page's WhatsApp quick action
// (§9.2, agreed with Shawn 17 Nov): their thread in the inbox, started when
// they never wrote to us. No body. Answers { conversationId } to open.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/whatsapp">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  const { id } = await ctx.params;
  const result = await openPersonWhatsapp(viewer, id);
  switch (result.kind) {
    case "ok":
      return Response.json({ conversationId: result.conversationId });
    case "forbidden":
      return forbidden(viewer, request, {
        what: "start a WhatsApp chat",
        resource: "conversation",
      });
    case "not_found":
      return apiError(404, "not_found", "This person no longer exists.");
    case "no_phone":
      return apiError(
        422,
        "no_phone",
        "This person has no usable WhatsApp number. Check their phone number first.",
      );
    case "number_taken":
      return apiError(
        409,
        "number_taken",
        "This number's WhatsApp chat is under another person. They may be a duplicate: check and merge them first.",
      );
  }
}
