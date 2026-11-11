import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { taskWriteResponse } from "@/lib/tasks/responses";
import { updateTask } from "@/lib/tasks/service";
import { taskUpdateSchema } from "@/lib/validation/task";

// PATCH /api/tasks/:id — §7, §9.14: complete, reopen, or edit title, due,
// assignee and notes. part_time writes only their own tasks (the service
// applies that); management reads only and gets an audited 403.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/tasks/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "task", "write").allowed)
    return forbidden(viewer, request, {
      what: "change tasks",
      resource: "task",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this task and try again.",
    );

  const parsed = taskUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateTask(id, parsed.data, ifMatch, viewer);
  if (result.kind === "forbidden")
    return forbidden(viewer, request, {
      what: "hand your tasks to someone else",
      resource: "task",
    });
  return taskWriteResponse(result, 200);
}
