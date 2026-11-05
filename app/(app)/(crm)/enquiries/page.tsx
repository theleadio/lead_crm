import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { listEnquiries } from "@/lib/enquiries/list";
import { listOwnerOptions } from "@/lib/people/service";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "@/lib/validation/enquiry-query";
import { EnquiriesQueue } from "./enquiries-queue";

// Spec §9.13 — Support's queue of enquiries, open and oldest first.
export default async function EnquiriesPage(props: PageProps<"/enquiries">) {
  const user = await getCurrentUser();
  // §6 enquiry row: marketing has no access, and the sidebar already hides
  // the link for them. GET /api/enquiries audits its own 403.
  if (!user || !permissionFor(user, "enquiry", "read").allowed) notFound();

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

  const [initial, users] = await Promise.all([
    listEnquiries(query, user),
    // A part-timer's queue is only their own, so they get no user list.
    write.assignedOnly ? [] : listOwnerOptions(),
  ]);

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
      }}
      users={users}
    />
  );
}
