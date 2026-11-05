import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { listEnquiries } from "@/lib/enquiries/list";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "@/lib/validation/enquiry-query";

// GET /api/enquiries — §7 list conventions, the §9.13 queue. Six roles read;
// marketing gets an audited 403. part_time is narrowed in the service's SQL.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "enquiry", "read").allowed)
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
