import Link from "next/link";
import { dictionary } from "../dictionaries";
import { enquiryUrl } from "../enquiry-link";
import { localePath, type Locale } from "../locale";

// §10.4's last step: the page Stripe returns a payer to. It confirms in plain
// words and creates nothing — the enrolment is confirmed by the payment
// webhook (§11.2, Shawn's), never by a page a visitor can open twice.
//
// `session_id` is read only to tell the two cases apart. It is not verified
// against Stripe and nothing is looked up with it: a page that said "paid"
// because a URL carried an id would be lying, and one that checked would
// still be the webhook's job done in the wrong place.

export async function ThankYouPage({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = dictionary(locale);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  // An HRDC registration pays nothing here, so it lands with its own marker
  // and never a session id (§10.4 step 4). Checked first: a URL carrying
  // both is hand-made, and the claim we can stand behind is the smaller one.
  const hrdc = one(sp.hrdc) === "1";
  const raw = one(sp.session_id);
  // Stripe leaves the placeholder in place if the success URL was built
  // wrongly, which is a misconfiguration, not a payment.
  const paid = !hrdc && Boolean(raw?.trim()) && raw !== "{CHECKOUT_SESSION_ID}";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-3 text-2xl font-semibold sm:text-3xl">
        {hrdc
          ? t["register.hrdc.heading"]
          : paid
            ? t["thankYou.heading"]
            : t["thankYou.noSession.heading"]}
      </h1>
      <p className="text-ink-muted mb-8 text-sm">
        {hrdc
          ? t["register.hrdc.body"]
          : paid
            ? t["thankYou.body"]
            : t["thankYou.noSession.body"]}
      </p>
      {/* Every state offers the way on; none shows an identifier, an amount
          or anything else the page cannot stand behind (§13). */}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href={localePath(locale, "/schedule")}
          className="text-ink underline underline-offset-4"
        >
          {t["register.toSchedule"]}
        </Link>
        <Link
          href={enquiryUrl(locale)}
          className="text-ink-muted hover:text-ink underline underline-offset-4"
        >
          {t["chrome.enquiry"]}
        </Link>
      </div>
    </main>
  );
}
