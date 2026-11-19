import type { NextRequest } from "next/server";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { matchPayment } from "@/lib/payments/match";
import { canRecordPayment } from "@/lib/payments/service";
import { paymentMatchResponse } from "@/lib/payments/write-response";
import { paymentMatchSchema } from "@/lib/validation/payment";

// POST /api/payments/:id/match — §7.1, §11.3. Ties an unmatched Stripe
// payment to a person and class in one transaction. No If-Match: the payment
// row lock and its match status are the concurrency control.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/payments/[id]/match">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canRecordPayment(viewer))
    return forbidden(viewer, request, {
      what: "match payments",
      resource: "payment",
    });

  const parsed = paymentMatchSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await matchPayment(id, parsed.data, viewer);
  return paymentMatchResponse(result, viewer, request);
}
