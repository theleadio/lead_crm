import type { NextRequest } from "next/server";
import { setClassStatus } from "@/lib/classes/service";
import { classWriteResponse } from "@/lib/classes/write-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { classStatusSchema } from "@/lib/validation/class";

// POST /api/classes/:id/status — §9.10 Open for booking / Back to draft
// (§12.1, v1.9). Its own action rather than a field on PATCH: keeping
// `status` out of the update schema is what stops the 9.9 form writing over
// the seat-derived statuses. Body `{status: 'open' | 'draft'}`.
// `/website` is the other control; nothing writes both.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/status">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "open or redraft classes",
      resource: "class",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this class and try again.",
    );

  const parsed = classStatusSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await setClassStatus(id, parsed.data.status, ifMatch, viewer);
  return classWriteResponse(result, viewer, request, "open or redraft classes");
}
