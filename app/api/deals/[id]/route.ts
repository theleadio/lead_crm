import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getDealDetail, updateDeal } from "@/lib/deals/detail-service";
import { keepCorporateFieldsMessage } from "@/lib/deals/stage-rules";
import { dealUpdateSchema } from "@/lib/validation/deal";

const notFound = () =>
  apiError(404, "not_found", "This deal doesn't exist or was removed.");

// GET /api/deals/:id — spec §7.1 / §9.6 detail.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/deals/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "deal", "read").allowed)
    return forbidden(viewer, request, { what: "deals", resource: "deal" });

  const { id } = await ctx.params;
  const result = await getDealDetail(id, viewer);
  if (result.kind === "not_found") return notFound();
  if (result.kind === "forbidden")
    return forbidden(viewer, request, {
      what: "this deal",
      resource: "deal",
    });
  return Response.json(result.deal);
}

// PATCH /api/deals/:id — spec §7 partial update with the If-Match stale-edit
// check. Never writes stage: that stays with POST /api/deals/:id/stage.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/deals/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  // §7 (v1.7): If-Match is the integer row version from the GET.
  const header = request.headers.get("If-Match");
  const ifMatch = header === null ? null : Number(header);
  if (ifMatch === null || !Number.isInteger(ifMatch) || ifMatch < 1)
    return apiError(
      428,
      "precondition_required",
      "Reload this deal and try again.",
    );

  const parsed = dealUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateDeal(id, parsed.data, ifMatch, viewer);

  switch (result.kind) {
    case "ok":
      return Response.json(result.deal);
    case "not_found":
      return notFound();
    case "forbidden":
      return forbidden(viewer, request, {
        what: "edit deals",
        resource: "deal",
      });
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this deal while you were editing. Reload to see their version.",
      );
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        { fields: result.fields },
      );
    case "corporate_fields_missing":
      // Same code, field names and missing[] as the stage route (§12.5).
      return Response.json(
        {
          error: {
            code: "corporate_fields_missing",
            message: keepCorporateFieldsMessage(result.stage, result.missing),
            missing: result.missing,
          },
        },
        { status: 422 },
      );
    case "lost_reason_required":
      return apiError(422, "lost_reason_required", result.message);
  }
}
