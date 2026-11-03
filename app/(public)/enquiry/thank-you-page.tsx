import Link from "next/link";
import { dictionary } from "../dictionaries";
import { localePath, type Locale } from "../locale";

// §10.3's last step: what a visitor sees once the enquiry is captured.
//
// A page of its own rather than a state inside the form, for the same reason
// §10.4's HRDC answer is one: the language control is a full navigation
// (§10.5), so an answer held in component state is gone the moment a visitor
// switches language — they were shown the empty form again, with a fresh
// idempotency key, and a second identical lead was one submit away.
//
// It creates nothing and reads nothing. §8.2 answered with a personId and a
// dealId; neither is carried here, because §13 says this names the next step
// and not an identifier.

export function EnquiryThankYouPage({ locale }: { locale: Locale }) {
  const t = dictionary(locale);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-3 text-2xl font-semibold sm:text-3xl">
        {t["form.thankYou.heading"]}
      </h1>
      <p className="text-ink-muted mb-8 text-sm">{t["form.thankYou.body"]}</p>
      {/* The way on, which for an enquiry is the schedule: nothing here shows
          an identifier or anything else the page cannot stand behind (§13). */}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href={localePath(locale, "/schedule")}
          className="text-ink underline underline-offset-4"
        >
          {t["register.toSchedule"]}
        </Link>
      </div>
    </main>
  );
}
