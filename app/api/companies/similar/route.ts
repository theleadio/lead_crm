import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany } from "@/lib/auth/permissions";
import { apiError } from "@/lib/api/errors";
import { similarCompanies } from "@/lib/companies/service";
import { similarSchema } from "@/lib/validation/company";

// GET /api/companies/similar?name=&registrationNo=&excludeId= — the
// "Similar companies" warning on Add and Edit company (spec §9.4 v1.5).
// Matching uses the database's normalise_company_name() (migration 003).
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteCompany(viewer))
    return apiError(
      403,
      "forbidden",
      "You don't have access to add companies.",
    );

  const sp = request.nextUrl.searchParams;
  const parsed = similarSchema.safeParse({
    name: sp.get("name") ?? undefined,
    registrationNo: sp.get("registrationNo") ?? undefined,
    excludeId: sp.get("excludeId") ?? undefined,
  });
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid search.");

  return Response.json({ data: await similarCompanies(parsed.data, viewer) });
}
