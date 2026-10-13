import type { NextRequest } from "next/server";
import { discardNotice } from "@/lib/classes/notices";
import { noticeWriteResponse } from "@/lib/classes/notice-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";

// POST /api/class-notices/:id/discard — §7.1, §9.10. Nothing was sent, so no
// event is raised; the class is then free for the next pending notice (§5).
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/class-notices/[id]/discard">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "discard class notices",
      resource: "class_notice",
    });

  const { id } = await ctx.params;
  const result = await discardNotice(id, viewer);
  return noticeWriteResponse(result, viewer, request, "discard class notices", {
    status: "discarded",
  });
}
