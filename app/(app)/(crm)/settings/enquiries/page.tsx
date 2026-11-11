import { notFound } from "next/navigation";
import { BackLink } from "@/components/detail-kit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditEnquirySettings, settingsView } from "@/lib/enquiries/settings";
import { ENQUIRY_CHANNELS } from "@/lib/enquiries/types";
import { EnquirySettings } from "./enquiry-settings";

// Enquiry settings (migration 019, moved from lead_sales' ticket settings):
// teams and members, categories, routing rules and holidays. super_admin and
// management only; POST /api/enquiry-settings checks again.
export default async function EnquirySettingsPage() {
  const user = await getCurrentUser();
  if (!user || !canEditEnquirySettings(user.role)) notFound();
  const view = await settingsView();
  return (
    <div className="max-w-4xl space-y-6">
      <BackLink href="/enquiries" label="Enquiries" />
      <h1 className="text-xl font-semibold">Enquiry settings</h1>
      <EnquirySettings view={view} channels={[...ENQUIRY_CHANNELS]} />
    </div>
  );
}
