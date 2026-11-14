import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { tagMergeResponse } from "@/lib/settings/responses";
import { mergeTag } from "@/lib/settings/tags";
import { tagMergeSchema } from "@/lib/validation/tag";

// POST /api/tags/:id/merge — §7.1, §9.15, design 8: move everyone to
// `intoTagId` and deactivate this tag. No If-Match (design 8). super_admin only.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/tags/[id]/merge">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, { what: "merge tags", resource: "tag" });

  const parsed = tagMergeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  const { id } = await ctx.params;
  return tagMergeResponse(await mergeTag(id, parsed.data.intoTagId, viewer));
}
