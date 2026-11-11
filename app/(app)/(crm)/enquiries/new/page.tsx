import { notFound } from "next/navigation";
import { BackLink } from "@/components/detail-kit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mayCreateEnquiries } from "@/lib/enquiries/create";
import { listCategories } from "@/lib/enquiries/routing";
import { NewEnquiryForm } from "./new-enquiry-form";

// An enquiry made by hand (a phone call, a walk-in) for someone already in the
// CRM (migration 019). A new contact is added on People first.
export default async function NewEnquiryPage() {
  const user = await getCurrentUser();
  if (!user || !(await mayCreateEnquiries(user))) notFound();
  const categories = (await listCategories()).filter((c) => c.active);
  return (
    <div className="max-w-xl space-y-6">
      <BackLink href="/enquiries" label="Enquiries" />
      <h1 className="text-xl font-semibold">New enquiry</h1>
      <NewEnquiryForm categories={categories} />
    </div>
  );
}
