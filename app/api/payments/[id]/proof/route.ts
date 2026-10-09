import type { NextRequest } from "next/server";
import { apiError, forbidden } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readPaymentProof } from "@/lib/payments/service";

// GET /api/payments/:id/proof — §9.12, §14, §6. Mints a short-lived signed URL
// for one proof and redirects to it, so nothing in a rendered page holds a URL
// that outlives the click. The read is audit-logged, as every sight of a
// payment record is (§6).
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/payments/[id]/proof">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const { id } = await ctx.params;
  const result = await readPaymentProof(id, viewer);
  switch (result.kind) {
    case "ok":
      // 302, not 307: the signed URL answers a plain GET, and the redirect is
      // never cached because the URL behind it expires (§14).
      return Response.redirect(result.url, 302);
    case "forbidden":
      return forbidden(viewer, request, {
        what: "payment proofs",
        resource: "payment",
      });
    case "not_found":
      return apiError(404, "not_found", "This payment has no proof on file.");
  }
}
