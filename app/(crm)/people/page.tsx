import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canAddPersonStandalone,
  canExportPeople,
  permissionFor,
} from "@/lib/auth/permissions";
import { PeopleList } from "./people-list";

// Hiding buttons here is UX only — every API route re-checks (spec §6).
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initialQ = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const user = await getCurrentUser();
  const canWrite = user
    ? permissionFor(user, "person", "write").allowed
    : false;
  const canExport = user ? canExportPeople(user.role) : false;
  const canAdd = user ? canAddPersonStandalone(user) : false;

  return (
    <PeopleList
      key={initialQ}
      initialQ={initialQ}
      canWrite={canWrite}
      canExport={canExport}
      canAdd={canAdd}
    />
  );
}
