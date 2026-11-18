import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { tagWriteResponse } from "@/lib/settings/responses";
import { updateTag } from "@/lib/settings/tags";
import { tagUpdateSchema } from "@/lib/validation/tag";

// PATCH /api/tags/:id — §7.1, §9.15: rename, deactivate or reactivate a user
// tag; 422 on system tags. super_admin only; If-Match contract.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/tags/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, { what: "change tags", resource: "tag" });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this tag and try again.",
    );

  const parsed = tagUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  const { id } = await ctx.params;
  return tagWriteResponse(await updateTag(id, parsed.data, ifMatch, viewer));
}
