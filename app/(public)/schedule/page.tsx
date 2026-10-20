import type { Metadata } from "next";
import { formatDateTime } from "@/lib/format/date";
import { getSchedule } from "./feed";
import { enquiryUrl } from "../enquiry-link";
import { ScheduleList } from "./schedule-list";

// §10.1. Rendered on the server so the schedule is indexable and a slow phone
// gets it without running JavaScript. Classes come from the §8.1 feed read in
// process (lib/public/schedule.ts), which is the same query, allow-list and
// validation the public route serves — no HTTP hop, so the page also builds
// with no server running. A failure throws to error.tsx (§13).

export const metadata: Metadata = {
  title: "Class schedule — LEAD",
  description:
    "Upcoming LEAD classes: dates, language, venue, price and HRDC claimability.",
};

export default async function SchedulePage() {
  const { classes, generatedAt } = await getSchedule();
  const enquire = enquiryUrl();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        Class schedule
      </h1>
      <p className="text-ink-muted mb-8 text-sm">
        Upcoming public classes. Dates and times are Malaysian time.
      </p>

      {classes.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-2xl border p-6">
          <h2 className="text-ink font-semibold">
            No public classes scheduled right now
          </h2>
          {enquire && (
            <a
              href={enquire}
              className="text-ink mt-3 inline-block text-sm underline underline-offset-4"
            >
              Tell us what you&apos;re looking for
            </a>
          )}
        </div>
      ) : (
        <>
          {/* When the data was true, not when this page read it: the cache
              below means a visitor can be seeing a five-minute-old copy. */}
          <p className="text-ink-subtle mb-4 text-xs">
            Schedule last updated {formatDateTime(generatedAt)}.
          </p>
          <ScheduleList classes={classes} enquireUrl={enquire} />
        </>
      )}
    </main>
  );
}
