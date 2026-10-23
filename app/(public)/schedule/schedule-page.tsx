import Link from "next/link";
import { formatDateTime } from "@/lib/format/date";
import { dictionary, fill } from "../dictionaries";
import { enquiryUrl } from "../enquiry-link";
import type { Locale } from "../locale";
import { getSchedule } from "./feed";
import { ScheduleList } from "./schedule-list";

// §10.1. Rendered on the server so the schedule is indexable and a slow phone
// gets it without running JavaScript. Classes come from the §8.1 feed read in
// process (lib/public/schedule.ts), which is the same query, allow-list and
// validation the public route serves — no HTTP hop, so the page also builds
// with no server running. A failure throws to error.tsx (§13).
//
// One body, rendered once per locale by the thin route files in (en)/ and
// zh/. The locale picks the words and the links; the feed read is identical
// either way, so both locales list the same classes from the same cache entry
// (website-localisation).

export async function SchedulePage({ locale }: { locale: Locale }) {
  const t = dictionary(locale);
  const { classes, generatedAt } = await getSchedule();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        {t["schedule.heading"]}
      </h1>
      <p className="text-ink-muted mb-8 text-sm">{t["schedule.standfirst"]}</p>

      {classes.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-2xl border p-6">
          <h2 className="text-ink font-semibold">
            {t["schedule.empty.heading"]}
          </h2>
          <Link
            href={enquiryUrl(locale)}
            className="text-ink mt-3 inline-block text-sm underline underline-offset-4"
          >
            {t["schedule.empty.cta"]}
          </Link>
        </div>
      ) : (
        <>
          {/* When the data was true, not when this page read it: the cache
              below means a visitor can be seeing a five-minute-old copy.
              The date keeps §4's format in both locales — it is data. */}
          <p className="text-ink-subtle mb-4 text-xs">
            {fill(t["schedule.lastUpdated"], {
              when: formatDateTime(generatedAt),
            })}
          </p>
          <ScheduleList classes={classes} locale={locale} t={t} />
        </>
      )}
    </main>
  );
}
