import type { Metadata } from "next";
import { alternates } from "../../../alternates";
import { dictionary } from "../../../dictionaries";
import { ThankYouPage } from "../../../register/thank-you-page";

// /zh/register/thank-you — where Stripe returns a Chinese payer (§10.4). The
// §8.3 body's `locale` is what chose this page over the English one.

const t = dictionary("zh");

export const metadata: Metadata = {
  title: t["thankYou.title"],
  description: t["thankYou.description"],
  alternates: alternates("zh", "/register/thank-you"),
  robots: { index: false, follow: true },
};

export default function Page(props: PageProps<"/zh/register/thank-you">) {
  return <ThankYouPage locale="zh" searchParams={props.searchParams} />;
}
