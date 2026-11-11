import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { mayUseEnquiries, teamsOf } from "@/lib/enquiries/access";
import { mayCreateEnquiries } from "@/lib/enquiries/create";
import { canEditEnquirySettings } from "@/lib/enquiries/settings";
import { listEnquiries } from "@/lib/enquiries/list";
import { listCategories, listTeams } from "@/lib/enquiries/routing";
import { listOwnerOptions } from "@/lib/people/service";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "@/lib/validation/enquiry-query";
import { EnquiriesQueue } from "./enquiries-queue";

// Spec §9.13 — Support's queue of enquiries, open and oldest first; since
// migration 019 every team's queue too.
export default async function EnquiriesPage(props: PageProps<"/enquiries">) {
  const user = await getCurrentUser();
  // §6 enquiry row, or a team (lib/enquiries/access.ts): marketing outside a
  // team has no access, and the sidebar already hides the link for them.
  // GET /api/enquiries audits its own 403.
  if (!user || !(await mayUseEnquiries(user, "read"))) notFound();

  // The URL is the query: a filtered view can be linked, and a reload restores
  // it because the server reads it too (§7).
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams))
    if (typeof value === "string") searchParams.set(key, value);
  const parsed = enquiryListQuerySchema.safeParse(
    readEnquiryParams(searchParams),
  );
  const query = parsed.success ? parsed.data : enquiryListQuerySchema.parse({});
  const write = permissionFor(user, "enquiry", "write");

  const [initial, teamIds, categories, teams, canCreate] = await Promise.all([
    listEnquiries(query, user),
    teamsOf(user.id),
    listCategories(),
    listTeams(),
    mayCreateEnquiries(user),
  ]);
  // A part-timer outside any team works only their own queue, so they get no
  // user list.
  const users =
    write.assignedOnly && teamIds.length === 0 ? [] : await listOwnerOptions();

  return (
    <EnquiriesQueue
      // A link that changes the URL (the panel's Close) starts the view again
      // from it; the queue's own changes use replaceState and stay mounted.
      key={searchParams.toString()}
      initial={initial}
      initialView={{
        q: query.q ?? "",
        status: query.status,
        category: query.category ?? "",
        team: query.team ?? "",
        myTeams: query.myTeams ?? false,
        channel: query.channel ?? "",
        assignee: query.assignee ?? "",
        mine: query.mine ?? false,
        sort: query.sort ?? "",
        page: query.page,
        selected: searchParams.get("selected") ?? "",
      }}
      access={{
        viewerId: user.id,
        canWrite: write.allowed,
        assignedOnly: write.assignedOnly,
        teamIds,
      }}
      users={users}
      categories={categories}
      teams={teams}
      canCreate={canCreate}
      canEditSettings={canEditEnquirySettings(user.role)}
    />
  );
}
