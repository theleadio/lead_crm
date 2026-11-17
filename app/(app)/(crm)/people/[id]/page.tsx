import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canReviewFlagged,
  canWriteCompany,
  canWriteDeal,
  permissionFor,
} from "@/lib/auth/permissions";
import { personWhatsapp } from "@/lib/inbox/service";
import { PersonDetailView } from "./person-detail";

// Spec §9.2. Hiding the edit form is UX only — PATCH re-checks (spec §6).
export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const canWrite = user
    ? permissionFor(user, "person", "write").allowed
    : false;

  const taskWrite = user ? permissionFor(user, "task", "write") : null;

  const canExportData = user?.role === "super_admin";

  // Their WhatsApp thread, or one this viewer may start; null hides the button.
  const whatsapp = user ? await personWhatsapp(user, id) : null;

  return (
    <PersonDetailView
      id={id}
      canWrite={canWrite}
      canExportData={canExportData}
      whatsapp={whatsapp}
      canEditCompany={user ? canWriteCompany(user) : false}
      canMerge={user?.role === "super_admin"}
      canReview={user ? canReviewFlagged(user) : false}
      canCreateDeal={user ? canWriteDeal(user) : false}
      taskAccess={
        user && taskWrite?.allowed
          ? { viewerId: user.id, assignedOnly: taskWrite.assignedOnly }
          : null
      }
    />
  );
}
