import Link from "next/link";
import { ChevronRight, Info, UserSearch } from "lucide-react";
import type { HomeNeedsAttention } from "@/lib/home/types";

// Spec §9.0. Only the `needs_review` queue for now: unmatched payments wait
// on the Stripe webhook (§11.3) and pending notices on the 9.9/9.10 flow,
// so neither gets a row that could only ever read zero.
export function NeedsAttentionPanel({ data }: { data: HomeNeedsAttention }) {
  return (
    <section className="border-line bg-surface-raised flex w-full flex-col overflow-hidden rounded-md border lg:w-100">
      <header className="flex flex-col gap-1 px-5 py-4.5">
        <h2 className="text-base font-bold">Needs attention</h2>
        <p className="text-ink-muted text-xs">
          Records waiting on someone with your role.
        </p>
      </header>

      {data.needsReview === 0 ? (
        <div className="border-line text-ink-muted border-t px-5 py-10 text-center text-sm">
          <p className="text-ink font-medium">Nothing needs review.</p>
          <p className="mt-1">
            Possible duplicates land here when a new person looks like one you
            already have.
          </p>
        </div>
      ) : (
        <Link
          href="/people?needs_review=1"
          className="border-line hover:bg-surface-muted focus-visible:outline-focus-ring flex items-center gap-3.5 border-t px-5 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <span
            aria-hidden="true"
            className="bg-warning-soft text-warning flex size-10 items-center justify-center rounded-sm"
          >
            <UserSearch className="size-4.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">People to review</span>
            <span className="text-ink-muted text-xs">
              Possible duplicates from the dedupe rules
            </span>
          </span>
          <span className="text-xl font-bold">{data.needsReview}</span>
          <ChevronRight aria-hidden="true" className="text-ink-subtle size-4" />
        </Link>
      )}

      <div className="flex flex-1 items-end">
        <p className="text-ink-subtle flex items-center gap-2 px-5 py-3.5 text-xs">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          Only items your role can act on appear here.
        </p>
      </div>
    </section>
  );
}
