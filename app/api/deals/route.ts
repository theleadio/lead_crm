import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listDeals } from "@/lib/deals/service";
import { dealListQuerySchema, readDealParams } from "@/lib/validation/deal";

// GET /api/deals — spec §7 list + §7.1 stageTotals (9.5 board).
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "deal", "read").allowed)
    return forbidden(viewer, request, { what: "deals", resource: "deal" });

  const parsed = dealListQuerySchema.safeParse(
    readDealParams(request.nextUrl.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listDeals(parsed.data, viewer));
}
