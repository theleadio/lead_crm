import type { NextRequest } from "next/server";
import { getClass, updateClass } from "@/lib/classes/service";
import { classWriteResponse } from "@/lib/classes/write-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass, permissionFor } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import {
  classNoticeChoiceSchema,
  classUpdateSchema,
} from "@/lib/validation/class";

// GET /api/classes/:id — one class for the 9.9 edit form, including the
// `version` the save sends back as If-Match (§7). Readable by every role on
// the §6 course/class row, same as the list.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "class", "read").allowed)
    return forbidden(viewer, request, { what: "classes", resource: "class" });

  const { id } = await ctx.params;
  const found = await getClass(id, viewer);
  if (!found) return apiError(404, "not_found", "This class doesn't exist.");
  return Response.json(found);
}

// PATCH /api/classes/:id — spec §7 / §7.1 / §9.9. Partial update under the
// v1.7 If-Match contract, plus the notice decision: a date, time or venue
// change on a class with students comes back as 409
// `notice_decision_required` with the recipient count, having saved nothing,
// and the 9.9 dialog sends the same body again with `notice`.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "edit classes",
      resource: "class",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this class and try again.",
    );

  const body = await request.json().catch(() => null);
  const { notice, ...patch } = (body ?? {}) as Record<string, unknown>;
  const choice = classNoticeChoiceSchema.safeParse(notice);
  if (!choice.success)
    return apiError(
      400,
      "validation_failed",
      "The notice choice must be 'prepare' or 'skip'.",
    );

  const parsed = classUpdateSchema.safeParse(patch);
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateClass(
    id,
    parsed.data,
    ifMatch,
    choice.data,
    viewer,
  );
  return classWriteResponse(result, viewer, request, "edit classes");
}
