import type { Metadata } from "next";
import { alternates } from "../../../alternates";
import { dictionary } from "../../../dictionaries";
import { RegisterPage } from "../../../register/register-page";

// /register/<classCode> — the English §10.4 page. This is the path the §8.1
// feed's registerUrl names and the one a class card links to.

const t = dictionary("en");

// The class code is in the URL, so each class's page names its own canonical
// and its Chinese counterpart (website-localisation). The title stays the
// page's own copy: the course name is data, and a metadata read would cost
// the feed a second time for a string a crawler sees in the heading anyway.
export async function generateMetadata({
  params,
}: PageProps<"/register/[classCode]">): Promise<Metadata> {
  const { classCode } = await params;
  const path = `/register/${encodeURIComponent(classCode)}`;
  return {
    title: t["register.title"],
    description: t["register.description"],
    alternates: alternates("en", path),
  };
}

export default async function Page({
  params,
}: PageProps<"/register/[classCode]">) {
  const { classCode } = await params;
  return <RegisterPage locale="en" classCode={classCode} />;
}
