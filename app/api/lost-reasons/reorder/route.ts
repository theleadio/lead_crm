import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { reorderLostReasons } from "@/lib/settings/lost-reasons";
import { lostReasonReorderResponse } from "@/lib/settings/responses";
import { lostReasonReorderSchema } from "@/lib/validation/lost-reason";

// POST /api/lost-reasons/reorder — §7.1, §9.15, design 7: `{ids}` names every
// reason once; anything else is a 422 and the order stays. super_admin only.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, {
      what: "reorder lost reasons",
      resource: "lost_reason",
    });

  const parsed = lostReasonReorderSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  return lostReasonReorderResponse(
    await reorderLostReasons(parsed.data.ids, viewer),
  );
}
