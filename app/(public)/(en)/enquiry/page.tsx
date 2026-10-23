import type { Metadata } from "next";
import { dictionary } from "../../dictionaries";
import { EnquiryPage } from "../../enquiry/enquiry-page";

// /enquiry — the English §10.3 form, at the path every class card, header and
// empty state has always pointed at.

const t = dictionary("en");

export const metadata: Metadata = {
  title: t["enquiry.title"],
  description: t["enquiry.description"],
  alternates: {
    canonical: "/enquiry",
    languages: { en: "/enquiry", zh: "/zh/enquiry" },
  },
};

export default function Page(props: PageProps<"/enquiry">) {
  return <EnquiryPage locale="en" searchParams={props.searchParams} />;
}
