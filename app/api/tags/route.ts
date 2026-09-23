import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError } from "@/lib/api/errors";
import { listTagOptions } from "@/lib/people/service";

// GET /api/tags — active tags for the tag filter and bulk add tag (spec §9.1).
// Not in the §7 table yet: raised in §15.3.
export async function GET() {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  return Response.json({ data: await listTagOptions() });
}
