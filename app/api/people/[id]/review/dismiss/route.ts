import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { clearReviewFlag } from "@/lib/people/duplicate-review";
import { reviewDismissSchema } from "@/lib/validation/person";

// POST /api/people/:id/review/dismiss — spec §12.2: these two are different
// people. Clears needs_review and closes the pair's §7.1 task. Not part of
// PATCH /api/people/:id: the flag is set by the dedupe rules, not typed by a
// user, and §9.16 must be able to tell the two apart.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/review/dismiss">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  // §7 (v1.7): If-Match is the integer row version from the GET.
  const header = request.headers.get("If-Match");
  const ifMatch = header === null ? NaN : Number(header);
  if (!Number.isInteger(ifMatch) || ifMatch < 1)
    return apiError(
      428,
      "precondition_required",
      "Reload this person and try again.",
    );

  const parsed = reviewDismissSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await clearReviewFlag(id, parsed.data.note, ifMatch, viewer);
  switch (result.kind) {
    case "dismissed":
      return new Response(null, { status: 204 });
    case "forbidden":
      return forbidden(viewer, request, {
        what: "clear a review flag",
        resource: "person",
      });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This person doesn't exist or was removed.",
      );
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this person while you were editing. Reload to see their version.",
      );
    case "not_flagged":
      return apiError(
        422,
        "not_flagged",
        "This person is no longer flagged for review. Reload to see where they stand.",
      );
  }
}
