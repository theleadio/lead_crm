import { redirect } from "next/navigation";

// Enquiry settings moved into Settings as the Enquiries tab (§9.15, design 1).
// Old links land there; the tab keeps the super_admin + management rule.
export default function EnquirySettingsPage() {
  redirect("/settings?tab=enquiries");
}
