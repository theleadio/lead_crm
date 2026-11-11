import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mayUseEnquiries } from "@/lib/enquiries/access";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import {
  assignEnquiry,
  closeEnquiry,
  setEnquiryCategory,
  setEnquiryPriority,
  setEnquiryStatus,
  type EnquiryWriteResult,
} from "@/lib/enquiries/service";
import { enquiryUpdateSchema } from "@/lib/validation/enquiry";

// How each closed state reads in the §13 "already closed" message.
const CLOSED_AS: Record<string, string> = {
  ai_resolved: "resolved by the WhatsApp assistant",
  human_resolved: "resolved",
  converted: "converted to a deal",
  closed: "closed",
};

// PATCH /api/enquiries/:id — §7, §9.13: assign, set category, close with an
// outcome; and since migration 019 waiting-on-customer and priority.
// super_admin and support write any enquiry, part_time only one assigned to
// them, a team member their team's (lib/enquiries/access.ts, applied by the
// service); the rest get an audited 403.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/enquiries/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!(await mayUseEnquiries(viewer, "write")))
    return forbidden(viewer, request, {
      what: "change enquiries",
      resource: "enquiry",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this enquiry and try again.",
    );

  const parsed = enquiryUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const body = parsed.data;
  let result: EnquiryWriteResult;
  if (body.action === "assign")
    result = await assignEnquiry(id, body.assignee, ifMatch, viewer);
  else if (body.action === "category")
    result = await setEnquiryCategory(id, body.category, ifMatch, viewer);
  else if (body.action === "status")
    result = await setEnquiryStatus(id, body.status, ifMatch, viewer);
  else if (body.action === "priority")
    result = await setEnquiryPriority(id, body.priority, ifMatch, viewer);
  else result = await closeEnquiry(id, body, ifMatch, viewer);

  switch (result.kind) {
    case "ok":
      return Response.json(result.enquiry);
    case "forbidden":
      return forbidden(viewer, request, {
        what: "assign enquiries",
        resource: "enquiry",
      });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This enquiry doesn't exist, or isn't one you can work on.",
      );
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this enquiry while you were editing. Reload to see their version.",
      );
    case "inactive_user":
      return apiError(
        422,
        "inactive_user",
        "That person's account is switched off, so they can't take new work. Pick someone else.",
        { fields: { assignee: "Pick an active user" } },
      );
    case "not_in_team":
      return apiError(
        422,
        "not_in_team",
        "This enquiry belongs to a restricted team, so only a member of that team can take it. Pick someone from the team, or add them in Settings.",
        { fields: { assignee: "Pick a member of the team" } },
      );
    case "unknown_category":
      return apiError(
        422,
        "unknown_category",
        "That category is switched off or no longer exists. Pick another.",
        { fields: { category: "Pick a category from the list" } },
      );
    // Convert only (POST …/convert); never from this route.
    case "deal_refused":
    case "person_gone":
      return apiError(422, "invalid", "That change isn't possible here.");
    case "not_open":
      return apiError(
        422,
        "not_open",
        `This enquiry is already ${CLOSED_AS[result.status] ?? "closed"}, and closing is final. If the customer has written again, start a new enquiry.`,
      );
  }
}
