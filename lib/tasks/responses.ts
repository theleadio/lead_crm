import { apiError } from "../api/errors.ts";
import type { TaskWriteResult } from "./types.ts";

// One §13 answer per service result, shared by POST /api/tasks and
// PATCH /api/tasks/:id. Kept out of the route files so it can be tested
// without a session. The 403 is not here: it needs the request to audit.
export function taskWriteResponse(
  result: Exclude<TaskWriteResult, { kind: "forbidden" }>,
  okStatus: 200 | 201,
): Response {
  switch (result.kind) {
    case "ok":
      return Response.json(result.task, { status: okStatus });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This record doesn't exist, or isn't one you can work on.",
      );
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this task while you were looking at it. Reload to see their version.",
      );
    case "conflict":
      return apiError(409, "conflict", result.message);
    case "inactive_user":
      return apiError(
        422,
        "inactive_user",
        "That person's account is switched off, so they can't take new work. Pick someone else.",
        { fields: { assignee: "Pick an active user" } },
      );
    case "due_locked":
      return apiError(
        422,
        "due_locked",
        "This reminder is due on the deal's HRDC deadline. Change the deadline on the deal.",
        { fields: { dueDate: "Change the deadline on the deal" } },
      );
  }
}
