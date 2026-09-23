import { getCurrentUser } from "@/lib/auth/current-user";
import { canExportPeople, permissionFor } from "@/lib/auth/permissions";
import { PeopleList } from "./people-list";

// Hiding buttons here is UX only — every API route re-checks (spec §6).
export default async function PeoplePage() {
  const user = await getCurrentUser();
  const canWrite = user
    ? permissionFor(user, "person", "write").allowed
    : false;
  const canExport = user ? canExportPeople(user.role) : false;

  return <PeopleList canWrite={canWrite} canExport={canExport} />;
}
