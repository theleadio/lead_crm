import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany } from "@/lib/auth/permissions";
import { apiError, validationError } from "@/lib/api/errors";
import { attachMember } from "@/lib/companies/service";
import { memberSchema } from "@/lib/validation/company";

const noAccess = () =>
  apiError(403, "forbidden", "You don't have access to edit companies.");

// POST /api/companies/:id/members — spec §7 attach a person to a company.
// `replaceCurrent: true` (the 9.2 picker) ends their other current
// memberships in the same transaction.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/companies/[id]/members">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer)) return noAccess();

  const parsed = memberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await attachMember(id, parsed.data, viewer);
  switch (result.kind) {
    case "attached":
      return Response.json(result.member, { status: 201 });
    case "forbidden":
      return noAccess();
    case "company_not_found":
      return apiError(
        404,
        "not_found",
        "This company doesn't exist or was removed.",
      );
    case "person_not_found":
      return apiError(
        404,
        "not_found",
        "This person doesn't exist or was removed.",
      );
    case "duplicate":
      return apiError(
        409,
        "duplicate",
        "This person already works at this company.",
      );
  }
}
