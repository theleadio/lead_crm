import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany, permissionFor } from "@/lib/auth/permissions";
import { apiError, validationError } from "@/lib/api/errors";
import { createCompany, listCompanies } from "@/lib/companies/service";
import { companyCreateSchema } from "@/lib/validation/company";

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  hrdcRegistered: bool,
  hasOpenDeal: bool,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/companies — spec §7 / §9.4 list (?q=&page=&limit=&filter[...]).
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return apiError(403, "forbidden", "You don't have access to companies.");

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    q: sp.get("q") ?? undefined,
    hrdcRegistered: sp.get("filter[hrdcRegistered]") ?? undefined,
    hasOpenDeal: sp.get("filter[hasOpenDeal]") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid list filters.");

  return Response.json(await listCompanies(parsed.data, viewer));
}

// POST /api/companies — spec §7 create. Duplicates only warn (see
// /api/companies/similar); there is no hard-match rule in MVP (§15.3).
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer))
    return apiError(
      403,
      "forbidden",
      "You don't have access to add companies.",
    );

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
    return apiError(
      403,
      "forbidden",
      "You don't have access to add companies.",
    );
  return Response.json({ id: result.id }, { status: 201 });
}
