import type { Metadata } from "next";
import { alternates } from "../../../alternates";
import { dictionary } from "../../../dictionaries";
import { ThankYouPage } from "../../../register/thank-you-page";

// /register/thank-you — where Stripe returns an English payer (§10.4).

const t = dictionary("en");

export const metadata: Metadata = {
  title: t["thankYou.title"],
  description: t["thankYou.description"],
  alternates: alternates("en", "/register/thank-you"),
  // Nothing here is worth indexing, and the URL carries a session id.
  robots: { index: false, follow: true },
};

export default function Page(props: PageProps<"/register/thank-you">) {
  return <ThankYouPage locale="en" searchParams={props.searchParams} />;
}
