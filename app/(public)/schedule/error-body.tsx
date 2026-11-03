"use client";

import type { Dict } from "../dictionaries";

// §13: the schedule failing to load is an error state with a way out, never
// "nothing scheduled". Reached only when nothing is cached — a good read is
// held for five minutes, and Next keeps serving the last good page while a
// revalidation fails.
//
// One body for both locales. An error boundary must be a client component and
// the platform hands it nothing, so its words cannot come from a server
// parent the way every other component's do. They come from its own route
// file instead, which imports one locale's strings — so the English page
// carries no Chinese (website-localisation).
export type ErrorStrings = Pick<
  Dict,
  | "schedule.heading"
  | "schedule.error.heading"
  | "schedule.error.body"
  | "schedule.error.retry"
>;

export function ScheduleErrorBody({
  t,
  retry,
}: {
  t: ErrorStrings;
  retry: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        {t["schedule.heading"]}
      </h1>
      <div className="border-line bg-surface-raised rounded-2xl border p-6">
        <h2 className="text-ink font-semibold">
          {t["schedule.error.heading"]}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          {t["schedule.error.body"]}
        </p>
        <button
          type="button"
          onClick={retry}
          className="text-ink mt-3 inline-block text-sm underline underline-offset-4"
        >
          {t["schedule.error.retry"]}
        </button>
      </div>
    </main>
  );
}
