import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, forbidden } from "@/lib/api/errors";
import { getPersonTimeline } from "@/lib/people/detail-service";

// GET /api/people/:id/timeline — spec §7.1. Newest first, 50 per page.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/timeline">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1)
    return apiError(400, "validation_failed", "Invalid page.");

  const { id } = await ctx.params;
  const result = await getPersonTimeline(id, viewer, page);
  if (result.kind === "not_found")
    return apiError(
      404,
      "not_found",
      "This person doesn't exist or was removed.",
    );
  if (result.kind === "forbidden")
    return forbidden(viewer, request, {
      what: "this person",
      resource: "person",
    });
  return Response.json(result.result);
}
