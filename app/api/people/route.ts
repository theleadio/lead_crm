import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { apiError } from "@/lib/api/errors";
import { listPeople } from "@/lib/people/service";
import { peopleListQuerySchema } from "@/lib/validation/people-query";

// GET /api/people — spec §7. Role checks (requirePermission, marketing
// masking, part_time assigned-only) land once app_user.role_code exists.
export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return apiError(401, "unauthenticated", "Sign in to continue.");

  const sp = request.nextUrl.searchParams;
  const parsed = peopleListQuerySchema.safeParse({
    q: sp.get("q") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    stage: sp.get("filter[stage]") ?? undefined,
    language: sp.get("filter[language]") ?? undefined,
    needsReview: sp.get("filter[needsReview]") ?? undefined,
  });

  if (!parsed.success) {
    return apiError(400, "validation_failed", "Invalid list filters.");
  }

  return Response.json(await listPeople(parsed.data));
}
