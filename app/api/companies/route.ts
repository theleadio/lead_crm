import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { createCompany, listCompanies } from "@/lib/companies/service";
import {
  companyCreateSchema,
  companyListQuerySchema,
} from "@/lib/validation/company";

// GET /api/companies — spec §7 / §9.4 list (?q=&page=&limit=&filter[...]).
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return forbidden(viewer, request, {
      what: "companies",
      resource: "company",
    });

  const sp = request.nextUrl.searchParams;
  const parsed = companyListQuerySchema.safeParse({
    q: sp.get("q") ?? undefined,
    hrdcRegistered: sp.get("filter[hrdcRegistered]") ?? undefined,
    hasOpenDeal: sp.get("filter[hasOpenDeal]") ?? undefined,
    similarTo: sp.get("filter[similarTo]") ?? undefined,
    registrationNo: sp.get("filter[registrationNo]") ?? undefined,
    excludeId: sp.get("filter[excludeId]") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid list filters.");

  return Response.json(await listCompanies(parsed.data, viewer));
}

// POST /api/companies — spec §7 create. Duplicates only warn (see
// filter[similarTo] on the list); there is no hard-match rule in MVP (§15.3).
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer))
    return forbidden(viewer, request, {
      what: "add companies",
      resource: "company",
    });

  const parsed = companyCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const result = await createCompany(parsed.data, viewer);
  if (result.kind === "invalid")
    return apiError(400, "validation_failed", "Check the highlighted fields.", {
      fields: result.fields,
    });
  if (result.kind !== "ok")
    return forbidden(viewer, request, {
      what: "add companies",
      resource: "company",
    });
  return Response.json({ id: result.id }, { status: 201 });
}
