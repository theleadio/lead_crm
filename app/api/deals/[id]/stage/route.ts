import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteDeal } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { moveDealStage } from "@/lib/deals/stage-service";
import { moveErrorMessage } from "@/lib/deals/stage-rules";
import { dealStageBodySchema } from "@/lib/validation/deal";

// POST /api/deals/:id/stage — spec §7 body {toStage, lostReasonId?}; rules
// in §12.5. Business-rule failures are 422 with `missing` where it applies.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/deals/[id]/stage">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  const denied = () =>
    forbidden(viewer, request, { what: "move deals", resource: "deal" });
  if (!canWriteDeal(viewer)) return denied();

  const parsed = dealStageBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await moveDealStage(id, parsed.data, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json(result.deal);
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This deal doesn't exist or was removed.",
      );
    case "forbidden":
      return denied();
    case "rule":
      return Response.json(
        {
          error: {
            code: result.code,
            message: moveErrorMessage(
              result.code,
              parsed.data.toStage,
              result.missing,
            ),
            ...(result.missing && { missing: result.missing }),
          },
        },
        { status: 422 },
      );
  }
}
