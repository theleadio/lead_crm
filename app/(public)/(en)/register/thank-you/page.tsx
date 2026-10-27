import type { Metadata } from "next";
import { dictionary } from "../../../dictionaries";
import { ThankYouPage } from "../../../register/thank-you-page";

// /register/thank-you — where Stripe returns an English payer (§10.4).

const t = dictionary("en");

export const metadata: Metadata = {
  title: t["thankYou.title"],
  description: t["thankYou.description"],
  alternates: {
    canonical: "/register/thank-you",
    languages: {
      en: "/register/thank-you",
      zh: "/zh/register/thank-you",
    },
  },
  // Nothing here is worth indexing, and the URL carries a session id.
  robots: { index: false, follow: true },
};

export default function Page(props: PageProps<"/register/thank-you">) {
  return <ThankYouPage locale="en" searchParams={props.searchParams} />;
}
