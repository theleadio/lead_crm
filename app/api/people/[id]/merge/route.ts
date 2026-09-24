import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, validationError } from "@/lib/api/errors";
import { mergePeople, mergeSchema } from "@/lib/people/merge-service";

// POST /api/people/:id/merge — spec §7. super_admin only, irreversible.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/merge">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (viewer.role !== "super_admin")
    return apiError(403, "forbidden", "Only a super admin can merge people.");

  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await mergePeople(id, parsed.data, viewer);
  switch (result.kind) {
    case "merged":
      return Response.json({ targetId: result.targetId, moved: result.moved });
    case "forbidden":
      return apiError(403, "forbidden", "Only a super admin can merge people.");
    case "not_found":
      return apiError(404, "not_found", "One of these people doesn't exist.");
    case "invalid":
      return apiError(400, "validation_failed", result.message);
    case "conflict":
      return apiError(409, "merge_conflict", result.message);
  }
}
