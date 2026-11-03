import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCompany } from "@/lib/auth/permissions";
import { CompanyDetailView } from "./company-detail";

// Spec §9.4 detail. Hiding the controls is UX only — the API re-checks (§6).
export default async function CompanyPage(props: PageProps<"/companies/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  return (
    <CompanyDetailView
      id={id}
      canWrite={user ? canWriteCompany(user) : false}
    />
  );
}
