import { apiError } from "../api/errors.ts";
import type { UserWriteResult } from "./service.ts";

// One §13 answer per createUser / updateUser result. Kept out of the route file so it can
// be tested without a session (as lib/tasks/responses.ts).
export function userWriteResponse(
  result: UserWriteResult,
  okStatus = 200,
): Response {
  switch (result.kind) {
    case "ok":
      return Response.json(result.user, { status: okStatus });
    case "not_found":
      return apiError(404, "not_found", "This user doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this user while you were looking. Reload to see their version.",
      );
    case "self_change":
      return apiError(
        422,
        "self_change",
        "You can't change your own role or switch off your own account. Ask another super admin.",
      );
    case "last_super_admin":
      return apiError(
        422,
        "last_super_admin",
        "There must always be at least one active super admin. Make someone else a super admin first.",
      );
    case "duplicate_email":
      return apiError(
        409,
        "duplicate_email",
        "Someone with this email is already a user.",
      );
  }
}
