import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { PersonDetailView } from "./person-detail";

// Spec §9.2. Hiding the edit form is UX only — PATCH re-checks (spec §6).
export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const canWrite = user
    ? permissionFor(user, "person", "write").allowed
    : false;

  const canExportData = user?.role === "super_admin";

  return (
    <PersonDetailView
      id={id}
      canWrite={canWrite}
      canExportData={canExportData}
    />
  );
}
