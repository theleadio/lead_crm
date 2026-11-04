import type { NextRequest } from "next/server";
import { apiError, forbidden } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canSeeIntegrations,
  integrationHealth,
} from "@/lib/health/integrations";

// GET /api/health/integrations — spec §11.4. The Settings > Integrations
// panel reads it. Settings is super_admin only (§6), so this is too.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canSeeIntegrations(viewer))
    return forbidden(viewer, request, {
      what: "integration health",
      resource: "settings",
    });
  return Response.json({ data: await integrationHealth() });
}
