import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError } from "@/lib/api/errors";
import { getPersonConsent } from "@/lib/people/detail-service";

// GET /api/consent/:personId — spec §7. Current marketing consent per purpose.
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/consent/[personId]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const { personId } = await ctx.params;
  const result = await getPersonConsent(personId, viewer);
  if (result.kind === "not_found")
    return apiError(
      404,
      "not_found",
      "This person doesn't exist or was removed.",
    );
  if (result.kind === "forbidden")
    return apiError(
      403,
      "forbidden",
      "You don't have access to consent records.",
    );
  return Response.json({ data: result.consent });
}
