import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCompanyDetail, updateCompany } from "@/lib/companies/service";
import { companyUpdateSchema } from "@/lib/validation/company";

const notFound = () =>
  apiError(404, "not_found", "This company doesn't exist or was removed.");

// GET /api/companies/:id — spec §7.1 / §9.4 detail.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/companies/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return forbidden(viewer, request, {
      what: "companies",
      resource: "company",
    });

  const { id } = await ctx.params;
  const result = await getCompanyDetail(id, viewer);
  if (result.kind === "not_found") return notFound();
  if (result.kind === "forbidden")
    return forbidden(viewer, request, {
      what: "this company",
      resource: "company",
    });
  return Response.json(result.detail);
}

// PATCH /api/companies/:id — spec §7 partial update, audit-logged.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/companies/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer))
    return forbidden(viewer, request, {
      what: "edit companies",
      resource: "company",
    });

  // §7 (v1.7): If-Match is the integer row version from the GET. New here —
  // company edit had no stale check at all before (record-concurrency).
  const header = request.headers.get("If-Match");
  const ifMatch = header === null ? NaN : Number(header);
  if (!Number.isInteger(ifMatch) || ifMatch < 1)
    return apiError(
      428,
      "precondition_required",
      "Reload this company and try again.",
    );

  const parsed = companyUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateCompany(id, parsed.data, ifMatch, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json({ id: result.id });
    case "not_found":
      return notFound();
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this company while you were editing. Reload to see their version.",
      );
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        { fields: result.fields },
      );
    case "forbidden":
      return forbidden(viewer, request, {
        what: "edit companies",
        resource: "company",
      });
  }
}
