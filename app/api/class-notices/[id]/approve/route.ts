import type { NextRequest } from "next/server";
import { approveNotice } from "@/lib/classes/notices";
import { noticeWriteResponse } from "@/lib/classes/notice-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";

// POST /api/class-notices/:id/approve — §7.1, §11.1. operations and
// super_admin only. Raises ClassNoticeApproved and stops: Shawn's worker
// sends the messages and writes `sent_at`, so this answers "queued", never
// "sent" (§12.11).
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/class-notices/[id]/approve">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "approve class notices",
      resource: "class_notice",
    });

  const { id } = await ctx.params;
  const result = await approveNotice(id, viewer);
  return noticeWriteResponse(result, viewer, request, "approve class notices", {
    status: "approved",
    message: "Approved. It is queued to go to the students on this class.",
  });
}
