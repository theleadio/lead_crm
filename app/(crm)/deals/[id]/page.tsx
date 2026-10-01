import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteDeal, permissionFor } from "@/lib/auth/permissions";
import { DealDetailView } from "./deal-detail";

// Spec §9.6. Hiding the form is UX only — GET and PATCH re-check (§6).
export default async function DealPage(props: PageProps<"/deals/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const canRead = user ? permissionFor(user, "deal", "read").allowed : false;

  // part_time has no deal access at all (§6), so the screen says so rather
  // than firing a request that can only come back 403. Same wording as 9.5.
  if (!canRead)
    return (
      <div
        role="alert"
        className="border-line bg-surface-raised rounded-md border p-6 text-sm"
      >
        <p className="text-ink font-medium">
          You don&apos;t have access to deals. Ask a super admin if you need it.
        </p>
      </div>
    );

  return (
    <DealDetailView id={id} canWrite={user ? canWriteDeal(user) : false} />
  );
}
