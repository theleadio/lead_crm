"use client";

// §13: the schedule failing to load is an error state with a way out, never
// "nothing scheduled". Reached only when nothing is cached — a good read is
// held for five minutes, and Next keeps serving the last good page while a
// revalidation fails.
export default function ScheduleError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-ink mb-2 text-2xl font-semibold sm:text-3xl">
        Class schedule
      </h1>
      <div className="border-line bg-surface-raised rounded-2xl border p-6">
        <h2 className="text-ink font-semibold">
          The schedule isn&apos;t loading right now
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={retry}
          className="text-ink mt-3 inline-block text-sm underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
