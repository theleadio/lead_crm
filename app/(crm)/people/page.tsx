import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canAddPersonStandalone,
  canExportPeople,
  permissionFor,
} from "@/lib/auth/permissions";
import { listPeople } from "@/lib/people/service";
import { peopleListQuerySchema } from "@/lib/validation/people-query";
import { NO_FILTERS, PeopleList } from "./people-list";

// Hiding buttons here is UX only — every API route re-checks (spec §6).
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const initialQ = one(sp.q);
  // §9.0 Home links here with filter[needsReview]=true; the list opens on that
  // filter instead of showing everyone. Same param name the API reads (§7).
  const needsReview = one(sp["filter[needsReview]"]);
  const initialFilters =
    needsReview === "true" || needsReview === "false"
      ? { ...NO_FILTERS, needsReview }
      : NO_FILTERS;
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
          peopleListQuerySchema.parse({
            q: initialQ || undefined,
            needsReview: initialFilters.needsReview || undefined,
          }),
          user,
        )
      : null;

  return (
    <PeopleList
      key={`${initialQ}|${initialFilters.needsReview}`}
      initialQ={initialQ}
      initialFilters={initialFilters}
      initial={initial}
      canWrite={canWrite}
      canExport={canExport}
      canAdd={canAdd}
    />
  );
}
