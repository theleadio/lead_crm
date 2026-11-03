import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MergePeopleView } from "./merge-people";

// Spec §9.3 — super_admin only. `?with=` is the person to keep; the person
// in the path is merged into them (POST /api/people/:id/merge). The API
// re-checks the role (spec §6).
export default async function MergePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string }>;
}) {
  const { id } = await props.params;
  const { with: keepId } = await props.searchParams;
  const user = await getCurrentUser();

  if (user?.role !== "super_admin")
    return <p role="alert">Only a super admin can merge people.</p>;
  if (!keepId)
    return (
      <p role="alert">
        Pick who to keep: open the duplicate from its task or the “already
        belongs to” message. <Link href={`/people/${id}`}>Back</Link>
      </p>
    );
  return <MergePeopleView sourceId={id} keepId={keepId} />;
}
