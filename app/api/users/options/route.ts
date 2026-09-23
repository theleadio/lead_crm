import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError } from "@/lib/api/errors";
import { listOwnerOptions } from "@/lib/people/service";

// GET /api/users/options — id + name only, for owner pickers/filters.
// GET /api/users (§7) is super_admin only, but every role filters by owner.
// Not in the §7 table yet: raised in §15.3.
export async function GET() {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  return Response.json({ data: await listOwnerOptions() });
}
