import type { NextRequest } from "next/server";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { convertEnquiry } from "@/lib/enquiries/convert";
import { enquiryConvertSchema } from "@/lib/validation/enquiry";

// POST /api/enquiries/:id/convert — §9.13 "convert to deal" (§7 endpoint
// list): opens a deal for the enquiry's person, links both, closes the
// enquiry as converted, raises EnquiryConverted (lib/enquiries/convert.ts).
// If-Match like every enquiry write.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/enquiries/[id]/convert">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this enquiry and try again.",
    );
  const parsed = enquiryConvertSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;
  const r = await convertEnquiry(id, parsed.data, ifMatch, viewer);
  switch (r.kind) {
    case "ok":
      return Response.json(
        { enquiry: r.enquiry, dealId: r.dealId },
        { status: 201 },
      );
    case "forbidden":
      return forbidden(viewer, request, {
        what: "convert enquiries to deals",
        resource: "deal",
      });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This enquiry doesn't exist, or isn't one you can work on.",
      );
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this enquiry while you were editing. Reload to see their version.",
      );
    case "not_open":
      return apiError(
        422,
        "not_open",
        "This enquiry is already closed, so it can't become a deal. If the customer has written again, start a new enquiry.",
      );
    case "deal_refused":
      return apiError(422, "invalid", "Check the highlighted fields.", {
        fields: r.fields,
      });
    case "person_gone":
      return apiError(
        422,
        "person_gone",
        "This enquiry's person was deleted or merged into another record, so no deal can be opened for them. Open the kept record and add the deal there.",
      );
    // Assign and category refusals: not reachable from a convert.
    case "inactive_user":
    case "not_in_team":
    case "unknown_category":
      return apiError(422, "invalid", "This enquiry can't be converted.");
  }
}
