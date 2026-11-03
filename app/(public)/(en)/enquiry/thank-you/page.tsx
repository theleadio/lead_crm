import type { Metadata } from "next";
import { alternates } from "../../../alternates";
import { dictionary } from "../../../dictionaries";
import { EnquiryThankYouPage } from "../../../enquiry/thank-you-page";

const t = dictionary("en");

export const metadata: Metadata = {
  title: t["form.thankYou.heading"],
  description: t["form.thankYou.body"],
  alternates: alternates("en", "/enquiry/thank-you"),
  // A confirmation is not a landing page: nothing to index, and a searcher
  // who found it would be told their enquiry was received when it was not.
  robots: { index: false, follow: true },
};

// Rendered per request, not at build: a prerendered page writes the
// metadataBase origin into the build output, and Netlify's secrets scan fails
// any build whose output holds an env var's value, APP_BASE_URL included.
export const dynamic = "force-dynamic";

export default function Page() {
  return <EnquiryThankYouPage locale="en" />;
}
