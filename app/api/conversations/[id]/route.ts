import type { NextRequest } from "next/server";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  assignConversation,
  enquiryFromConversation,
  mayUseInbox,
  setConversationStatus,
} from "@/lib/inbox/service";
import {
  conversationEnquirySchema,
  conversationUpdateSchema,
} from "@/lib/validation/conversation";

// The inbox's writes (migration 019). Who may see a conversation is decided in
// lib/inbox/service.ts; one the viewer may not see answers 404, as if missing,
// and the refusal is audited there.

const notFound = () =>
  apiError(
    404,
    "not_found",
    "This conversation doesn't exist, or isn't one you can see.",
  );

// PATCH /api/conversations/:id — assign it, or open / snooze / close it.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!(await mayUseInbox(viewer)))
    return forbidden(viewer, request, {
      what: "the inbox",
      resource: "conversation",
    });
  const parsed = conversationUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;
  const body = parsed.data;
  const result =
    body.action === "assign"
      ? await assignConversation(viewer, id, body.assignee)
      : await setConversationStatus(viewer, id, body.status);
  if (result.kind === "not_found") return notFound();
  if (result.kind === "invalid")
    return apiError(422, "invalid", result.message);
  return new Response(null, { status: 204 });
}

// POST /api/conversations/:id — "Make enquiry": the category picks the team;
// the deadline counts from the customer's last message.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!(await mayUseInbox(viewer)))
    return forbidden(viewer, request, {
      what: "the inbox",
      resource: "conversation",
    });
  const parsed = conversationEnquirySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;
  const result = await enquiryFromConversation(viewer, id, parsed.data);
  switch (result.kind) {
    case "ok":
      return Response.json(
        { id: result.enquiry.id, number: result.enquiry.number },
        { status: 201 },
      );
    case "not_found":
      return notFound();
    case "forbidden":
      return forbidden(viewer, request, {
        what: "create enquiries",
        resource: "enquiry",
      });
    case "invalid":
      return apiError(422, "invalid", "Check the highlighted fields.", {
        fields: { [result.field]: result.message },
      });
  }
}
