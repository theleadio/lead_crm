import Link from "next/link";
import { BellRing, ChevronRight, Info, UserSearch } from "lucide-react";
import type { HomeNeedsAttention } from "@/lib/home/types";

// Spec §9.0. One row per item, and an item a role cannot act on is absent
// rather than zero: operations approves notices but only reads people, sales
// is the other way round. Unmatched payments wait on the Stripe webhook
// (§11.3), so they get no row that could only ever read zero.
export function NeedsAttentionPanel({ data }: { data: HomeNeedsAttention }) {
  const rows = [
    data.needsReview === null
      ? null
      : {
          key: "review",
          count: data.needsReview,
          href: "/people?filter[needsReview]=true",
          icon: <UserSearch className="size-4.5" />,
          title: "People to review",
          hint: "Possible duplicates from the dedupe rules",
        },
    data.pendingNotices === null
      ? null
      : {
          key: "notices",
          count: data.pendingNotices,
          // ponytail: the classes list has no "has a pending notice" filter,
          // so this lands on the list. Point it at a filtered list when 9.8
          // grows one.
          href: "/classes",
          icon: <BellRing className="size-4.5" />,
          title: "Class notices to approve",
          hint: "Students are not told until you approve",
        },
  ].filter((r): r is NonNullable<typeof r> => r !== null && r.count > 0);

  return (
    <section className="border-line bg-surface-raised flex w-full flex-col overflow-hidden rounded-md border lg:w-100">
      <header className="flex flex-col gap-1 px-5 py-4.5">
        <h2 className="text-base font-bold">Needs attention</h2>
        <p className="text-ink-muted text-xs">
          Records waiting on someone with your role.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="border-line text-ink-muted border-t px-5 py-10 text-center text-sm">
          <p className="text-ink font-medium">Nothing needs attention.</p>
          <p className="mt-1">
            Possible duplicates and class notices waiting for approval land
            here.
          </p>
        </div>
      ) : (
        rows.map((row) => (
          <Link
            key={row.key}
            href={row.href}
            className="border-line hover:bg-surface-muted focus-visible:outline-focus-ring flex items-center gap-3.5 border-t px-5 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <span
              aria-hidden="true"
              className="bg-warning-soft text-warning flex size-10 items-center justify-center rounded-sm"
            >
              {row.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold">{row.title}</span>
              <span className="text-ink-muted text-xs">{row.hint}</span>
            </span>
            <span className="text-xl font-bold">{row.count}</span>
            <ChevronRight
              aria-hidden="true"
              className="text-ink-subtle size-4"
            />
          </Link>
        ))
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
