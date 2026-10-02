import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canAddPersonStandalone,
  canExportPeople,
  permissionFor,
} from "@/lib/auth/permissions";
import { listPeople } from "@/lib/people/service";
import { peopleListQuerySchema } from "@/lib/validation/people-query";
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

  // First page rendered on the server: the client would otherwise paint an
  // empty table and then spend a whole auth + query round trip on /api/people
  // after mount. Filter and page changes still go through the API.
  const initial =
    user && permissionFor(user, "person", "read").allowed
      ? await listPeople(
          peopleListQuerySchema.parse({ q: initialQ || undefined }),
          user,
        )
      : null;

  return (
    <PeopleList
      key={initialQ}
      initialQ={initialQ}
      initial={initial}
      canWrite={canWrite}
      canExport={canExport}
      canAdd={canAdd}
    />
  );
}
