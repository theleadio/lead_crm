import type { NextRequest } from "next/server";
import { cancelClass } from "@/lib/classes/service";
import { classWriteResponse } from "@/lib/classes/write-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { classCancelSchema } from "@/lib/validation/class-cancel";

// POST /api/classes/:id/cancel — §7, §9.10. Its own action, like publish: the
// class status, every seat it held and its pending notice move together
// (§12.1, §11.1). Refunds are not touched here — super_admin does those in
// Stripe (§6), and the dialog says so.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/cancel">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "cancel classes",
      resource: "class",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this class and try again.",
    );

  const parsed = classCancelSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await cancelClass(id, parsed.data, ifMatch, viewer);
  return classWriteResponse(result, viewer, request, "cancel classes");
}
