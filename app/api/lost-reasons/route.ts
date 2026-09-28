import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { listLostReasons } from "@/lib/deals/service";

// GET /api/lost-reasons — spec §7.1: active reasons in order, for every
// role that can read deals (the 9.5 Lost dialog). CRUD is 9.15 Settings.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "deal", "read").allowed)
    return forbidden(viewer, request, {
      what: "lost reasons",
      resource: "lost_reason",
    });
  return Response.json({ data: await listLostReasons() });
}
