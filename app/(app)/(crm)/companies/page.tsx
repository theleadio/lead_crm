import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany, permissionFor } from "@/lib/auth/permissions";
import { listCompanies } from "@/lib/companies/service";
import { companyListQuerySchema } from "@/lib/validation/company";
import { CompaniesList } from "./companies-list";

// Spec §9.4. Hiding the Add button is UX only — the API re-checks (spec §6).
export default async function CompaniesPage() {
  const user = await getCurrentUser();
  // First page on the server, so the table paints with rows instead of
  // skeletons; filters and paging still go through /api/companies.
  const initial =
    user && permissionFor(user, "person", "read").allowed
      ? await listCompanies(
          companyListQuerySchema.parse({ sort: "name" }),
          user,
        )
      : null;
  return (
    <CompaniesList
      initial={initial}
      canWrite={user ? canWriteCompany(user) : false}
    />
  );
}
