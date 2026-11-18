import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listLostReasons } from "@/lib/deals/service";
import { createLostReason } from "@/lib/settings/lost-reasons";
import { lostReasonWriteResponse } from "@/lib/settings/responses";
import { lostReasonCreateSchema } from "@/lib/validation/lost-reason";

// GET /api/lost-reasons — spec §7.1: active reasons in order, for every
// role that can read deals (the 9.5 Lost dialog). The writes are 9.15 Settings.
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

// POST /api/lost-reasons — §7.1, §9.15: a new reason, placed last.
// super_admin only.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, {
      what: "add lost reasons",
      resource: "lost_reason",
    });

  const parsed = lostReasonCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  return lostReasonWriteResponse(
    await createLostReason(parsed.data, viewer),
    201,
  );
}
