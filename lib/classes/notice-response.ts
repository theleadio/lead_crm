import { apiError, forbidden } from "../api/errors.ts";
import type { Viewer } from "../auth/permissions.ts";
import type { NoticeWriteResult } from "./notices.ts";

// One place that turns a notice write result into its §7 status code, shared
// by edit, approve and discard so the three cannot drift (§13: every message
// says what happened and what to do next).
export async function noticeWriteResponse(
  result: NoticeWriteResult,
  viewer: Viewer,
  request: Request,
  what: string,
  // Approve says the notice is queued, not sent: sending is Shawn's worker's
  // (§11.1), so the screen must not claim the students have been told.
  okBody?: Record<string, unknown>,
): Promise<Response> {
  switch (result.kind) {
    case "ok":
      return Response.json({
        id: result.id,
        classId: result.classId,
        ...okBody,
      });
    case "forbidden":
      return forbidden(viewer, request, { what, resource: "class_notice" });
    case "not_found":
      return apiError(404, "not_found", "This notice doesn't exist.");
    case "not_pending":
      return apiError(
        409,
        "notice_not_pending",
        `This notice is already ${result.status}. Reload the class to see where it got to.`,
      );
  }
}
