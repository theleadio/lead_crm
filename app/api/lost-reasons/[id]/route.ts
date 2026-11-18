import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { updateLostReason } from "@/lib/settings/lost-reasons";
import { lostReasonWriteResponse } from "@/lib/settings/responses";
import { lostReasonUpdateSchema } from "@/lib/validation/lost-reason";

// PATCH /api/lost-reasons/:id — §7.1, §9.15: labels and active only; a code
// in the body is a 422. super_admin only; If-Match contract.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/lost-reasons/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, {
      what: "change lost reasons",
      resource: "lost_reason",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this reason and try again.",
    );

  const parsed = lostReasonUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  const { id } = await ctx.params;
  return lostReasonWriteResponse(
    await updateLostReason(id, parsed.data, ifMatch, viewer),
  );
}
