import type { Metadata } from "next";
import { alternates } from "../../alternates";
import { dictionary } from "../../dictionaries";
import { EnquiryPage } from "../../enquiry/enquiry-page";

// /zh/enquiry — the same §10.3 form in Chinese. Same submit path, same §8.2
// checks; the locale decides the words and the preferred-language default.

const t = dictionary("zh");

export const metadata: Metadata = {
  title: t["enquiry.title"],
  description: t["enquiry.description"],
  alternates: alternates("zh", "/enquiry"),
};

export default function Page(props: PageProps<"/zh/enquiry">) {
  return <EnquiryPage locale="zh" searchParams={props.searchParams} />;
}
