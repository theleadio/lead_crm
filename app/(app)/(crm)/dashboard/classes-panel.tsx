import Link from "next/link";
import { kualaLumpurDay } from "@/lib/validation/report";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { classStatusBadge, seatBarColor } from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import type { HomeClass } from "@/lib/home/types";

const DAY = 24 * 60 * 60 * 1000;

// "Push" hint: a class at most this many days out that is under half sold.
// A display aid for sales, not a stored state; tune here.
const PUSH_WITHIN_DAYS = 7;
const PUSH_BELOW_SHARE = 0.5;

// Whole days from today (Malaysian calendar, §4) to a YYYY-MM-DD date.
function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY);
}

function startsLabel(days: number): string {
  if (days <= 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  return `Starts in ${days} days`;
}

// Spec §9.0 Home. One card per class starting in the next 14 days, built
// like the deals stage cards: seats sold is the headline number, so sales
// can see at a glance which class still needs selling.
export function ClassesPanel({
  classes,
  windowLabel,
}: {
  classes: HomeClass[];
  windowLabel: string;
}) {
  const today = kualaLumpurDay();

  return (
    <section className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-bold">Upcoming classes</h2>
          <span className="bg-surface-sunken text-ink-muted rounded-full px-2 py-0.5 text-xs font-semibold">
            {classes.length}
          </span>
          <span className="text-ink-muted text-[13px]">
            Next 14 days · {windowLabel}
          </span>
        </div>
        <Link
          href="/classes"
          className="text-blue-ink flex items-center gap-1 text-[13px] font-semibold"
        >
          All classes
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </header>

      {classes.length === 0 ? (
        <div className="border-line bg-surface-raised text-ink-muted rounded-md border px-5 py-6 text-sm">
          <p className="text-ink font-medium">No class starts in 14 days.</p>
          <p className="mt-1">
            Scheduled classes appear here as their start date comes up.{" "}
            <Link href="/classes" className="text-blue-ink font-semibold">
              Open Classes
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id}>
              <SeatCard cls={c} days={daysUntil(c.startDate, today)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SeatCard({ cls: c, days }: { cls: HomeClass; days: number }) {
  const status = classStatusBadge(c.status);
  const share = c.capacity > 0 ? c.sold / c.capacity : 0;
  const pct = Math.min(100, Math.round(share * 100));
  const left = Math.max(0, c.capacity - c.sold);
  // Draft and full classes take no bookings to push.
  const needsPush =
    ["open", "few_seats"].includes(c.status) &&
    days <= PUSH_WITHIN_DAYS &&
    share < PUSH_BELOW_SHARE;
  const where =
    c.mode === "online"
      ? "Online"
      : [c.venue, c.city].filter(Boolean).join(", ") || "Venue not set";

  return (
    <Link
      href={`/classes/${c.id}`}
      className="border-line bg-surface-raised hover:bg-surface-muted focus-visible:outline-focus-ring flex h-full flex-col gap-4 rounded-md border p-5 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-bold">{c.code}</span>
          <span className="text-ink-muted truncate text-xs">
            {c.courseName}
          </span>
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </span>

      <span className="text-ink-muted text-xs">
        {formatDateRange(c.startDate, c.endDate)} ·{" "}
        {c.language === "zh" ? "中文" : "English"} · {where}
      </span>

      {/* Seats sold leads the card. The count is written out beside the
          bar, so the colour is never the only signal (§13). */}
      <span className="flex flex-col gap-2">
        <span className="flex items-end justify-between gap-2">
          <span className="flex items-end gap-1.5">
            <span className="text-[28px] leading-none font-bold tabular-nums">
              {c.sold}
            </span>
            <span className="text-ink-muted text-[13px]">
              / {c.capacity} seats sold
            </span>
          </span>
          <span className="text-ink-muted text-[13px] tabular-nums">
            {pct}%
          </span>
        </span>
        <span className="bg-surface-sunken h-2 overflow-hidden rounded-full">
          <span
            className={`block h-full rounded-full ${seatBarColor(c.status)}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      <span className="mt-auto flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-muted">
          {left} {left === 1 ? "seat" : "seats"} left · {startsLabel(days)}
        </span>
        {needsPush && <Badge variant="warning">Needs a push</Badge>}
      </span>
    </Link>
  );
}
