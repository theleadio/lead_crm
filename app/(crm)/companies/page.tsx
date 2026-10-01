import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany } from "@/lib/auth/permissions";
import { CompaniesList } from "./companies-list";

// Spec §9.4. Hiding the Add button is UX only — the API re-checks (spec §6).
export default async function CompaniesPage() {
  const user = await getCurrentUser();
  return <CompaniesList canWrite={user ? canWriteCompany(user) : false} />;
}
