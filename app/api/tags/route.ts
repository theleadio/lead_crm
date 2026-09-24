import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError } from "@/lib/api/errors";
import { listTagOptions } from "@/lib/people/service";

// GET /api/tags — active tags for the tag filter and bulk add tag (spec §9.1).
// Spec §7.1.
export async function GET() {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return apiError(403, "forbidden", "You don't have access to tags.");
  return Response.json({ data: await listTagOptions() });
}
