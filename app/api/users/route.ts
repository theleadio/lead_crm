import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { listUsers } from "@/lib/users/service";

// GET /api/users — §7, §9.15 Users: every user with status and last sign-in.
// super_admin only (§6 settings row); owner pickers use /api/users/options.
// POST (add a user) arrives with Google sign-in, phase 2.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "read").allowed)
    return forbidden(viewer, request, { what: "users", resource: "app_user" });
  return Response.json({ data: await listUsers() });
}
