import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { mayUseEnquiries } from "@/lib/enquiries/access";
import { createEnquiry } from "@/lib/enquiries/create";
import { listEnquiries } from "@/lib/enquiries/list";
import { enquiryCreateSchema } from "@/lib/validation/enquiry";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "@/lib/validation/enquiry-query";

// GET /api/enquiries — §7 list conventions, the §9.13 queue. Six roles read,
// and any team member (migration 019); anyone else gets an audited 403.
// part_time, restricted teams and team membership are applied in the
// service's SQL (lib/enquiries/access.ts).
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!(await mayUseEnquiries(viewer, "read")))
    return forbidden(viewer, request, {
      what: "enquiries",
      resource: "enquiry",
    });

  const parsed = enquiryListQuerySchema.safeParse(
    readEnquiryParams(request.nextUrl.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  return Response.json(await listEnquiries(parsed.data, viewer));
}

// POST /api/enquiries — one made by hand (a phone call, a walk-in) for a
// person already in the CRM. The category picks the team and the team's round
// robin the assignee; the deadline is the next working day.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  const parsed = enquiryCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  const result = await createEnquiry(parsed.data, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json(
        { id: result.enquiry.id, number: result.enquiry.number },
        { status: 201 },
      );
    case "forbidden":
      return forbidden(viewer, request, {
        what: "create enquiries",
        resource: "enquiry",
      });
    case "invalid":
      return apiError(422, "invalid", "Check the highlighted fields.", {
        fields: { [result.field]: result.message },
      });
  }
}
