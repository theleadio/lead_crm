import type { Metadata } from "next";
import { formatDateTime } from "@/lib/format/date";
import { readSchedule } from "@/lib/public/schedule-feed";
import { enquiryUrl } from "../enquiry-link";
import { ScheduleList } from "./schedule-list";

// §10.1. Rendered on the server so the schedule is indexable and a slow phone
// gets it without running JavaScript. Classes come from the §8.1 feed, never
// from the database (§3 layering).

export const metadata: Metadata = {
  title: "Class schedule — LEAD",
  description:
    "Upcoming LEAD classes: dates, language, venue, price and HRDC claimability.",
};

export default async function SchedulePage() {
  const read = await readSchedule();
  const enquire = enquiryUrl();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        Class schedule
      </h1>
      <p className="text-ink-muted mb-8 text-sm">
        Upcoming public classes. Dates and times are Malaysian time.
      </p>

      {read.kind === "unavailable" ? (
        // §13: an error state with a retry, never "nothing scheduled".
        <div className="border-line bg-surface-raised rounded-2xl border p-6">
          <h2 className="text-ink font-semibold">
            The schedule isn&apos;t loading right now
          </h2>
          <p className="text-ink-muted mt-1 text-sm">
            Please try again in a moment.
          </p>
          <a
            href="/schedule"
            className="text-ink mt-3 inline-block text-sm underline underline-offset-4"
          >
            Try again
          </a>
        </div>
      ) : read.classes.length === 0 ? (
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
          {read.kind === "stale" && (
            // Say when, so an old date is never presented as current with no
            // hint (§10.1).
            <p className="text-ink-subtle mb-4 text-xs">
              Schedule last updated {formatDateTime(read.fetchedAt)}.
            </p>
          )}
          <ScheduleList classes={read.classes} />
        </>
      )}
    </main>
  );
}
