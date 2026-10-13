import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteDeal, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { createDeal } from "@/lib/deals/detail-service";
import { listDeals } from "@/lib/deals/service";
import {
  dealCreateSchema,
  dealListQuerySchema,
  readDealParams,
} from "@/lib/validation/deal";

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

// POST /api/deals — spec §7 "Create". The New deal control on the §9.5 board
// and the §9.2 person header. The deal opens in `new`; `stage` and `classId`
// are not fields (§12.5, §9.6).
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteDeal(viewer))
    return forbidden(viewer, request, {
      what: "add deals",
      resource: "deal",
    });

  const parsed = dealCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await createDeal(parsed.data, viewer);
  switch (result.kind) {
    case "created":
      return Response.json(result.deal, { status: 201 });
    case "not_found":
      return apiError(404, "not_found", "That person no longer exists.");
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        {
          fields: result.fields,
        },
      );
    case "forbidden":
      return forbidden(viewer, request, {
        what: "add deals",
        resource: "deal",
      });
  }
}
