import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany, permissionFor } from "@/lib/auth/permissions";
import { apiError, validationError } from "@/lib/api/errors";
import { getCompanyDetail, updateCompany } from "@/lib/companies/service";
import { companyUpdateSchema } from "@/lib/validation/company";

const notFound = () =>
  apiError(404, "not_found", "This company doesn't exist or was removed.");

// GET /api/companies/:id — spec §7.1 / §9.4 detail.
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/companies/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return apiError(403, "forbidden", "You don't have access to companies.");

  const { id } = await ctx.params;
  const result = await getCompanyDetail(id, viewer);
  if (result.kind === "not_found") return notFound();
  if (result.kind === "forbidden")
    return apiError(403, "forbidden", "You don't have access to this company.");
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
    return apiError(
      403,
      "forbidden",
      "You don't have access to edit companies.",
    );

  const parsed = companyUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await updateCompany(id, parsed.data, viewer);
  switch (result.kind) {
    case "ok":
      return Response.json({ id: result.id });
    case "not_found":
      return notFound();
    case "invalid":
      return apiError(
        400,
        "validation_failed",
        "Check the highlighted fields.",
        { fields: result.fields },
      );
    case "forbidden":
      return apiError(
        403,
        "forbidden",
        "You don't have access to edit companies.",
      );
  }
}
