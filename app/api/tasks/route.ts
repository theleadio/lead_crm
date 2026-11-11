import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listTasks } from "@/lib/tasks/list";
import { taskWriteResponse } from "@/lib/tasks/responses";
import { createTask } from "@/lib/tasks/service";
import {
  readTaskParams,
  taskCreateSchema,
  taskListQuerySchema,
} from "@/lib/validation/task";

// GET /api/tasks — §7 list conventions, the §9.14 list. Every role reads;
// part_time is narrowed to their own tasks in the service's SQL.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const parsed = taskListQuerySchema.safeParse(
    readTaskParams(request.nextUrl.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listTasks(parsed.data, viewer));
}

// POST /api/tasks — §7, §9.14: a call, follow-up or task about a person, deal
// or enrolment. Management reads only (§6), so it gets an audited 403.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "task", "write").allowed)
    return forbidden(viewer, request, { what: "add tasks", resource: "task" });

  const parsed = taskCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  return taskWriteResponse(await createTask(parsed.data, viewer), 201);
}
