import { TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format/date";
import { daysInRange } from "@/lib/reports/ads";
import type { AdsWeeks } from "@/lib/reports/types";
import { Figures, PanelCard } from "./panel-card";

// §9.18 leads over time: the page's only time axis. Small multiples — one
// column chart per channel on a shared y scale — rather than one stacked
// column per week.
//
// Why facets and not a stack: three channels would need three fills, and the
// brand has exactly one hue that passes the chart-mark checks (design
// decision 9). Facets need no second hue, and the real question is how a
// channel moved week to week, which a facet answers and a stack buries.

export const CHANNEL_LABEL: Record<string, string> = {
  lead_form: "Meta Lead Ads",
  ctwa: "Click to WhatsApp",
  web_form: "Website form",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  referral: "Referral",
  payment_link: "Payment link",
  // The SalesProcess attribution import.
  import: "SalesProcess",
};

// Tall enough to read a week-on-week change; columns share the card's width
// so a short range is not a cluster of slivers in an empty box.
const CHART_H = 160;

// "06 Oct" under a column: the page's own date format without the year, so
// September reads "Sep" as everywhere else.
function shortDay(weekStart: string): string {
  return formatDate(`${weekStart}T00:00:00Z`).slice(0, 6);
}

function Facet({
  channel,
  weeks,
  peak,
  daysOf,
}: {
  channel: string;
  weeks: AdsWeeks["weeks"];
  peak: number;
  // Days of each week inside the range: under 7 is a part week.
  daysOf: (weekStart: string) => number;
}) {
  const total = weeks.reduce((n, w) => n + (w.byChannel[channel] ?? 0), 0);
  // Every column carries its number while there are few enough to read;
  // past a dozen only the tallest does.
  const labelAll = weeks.length <= 12;
  // The tallest column in this facet, direct-labelled.
  const best = weeks.reduce(
    (b, w) =>
      (w.byChannel[channel] ?? 0) > (b.byChannel[channel] ?? 0) ? w : b,
    weeks[0],
  );
  // At most about a dozen date labels, however long the range.
  const every = Math.max(1, Math.ceil(weeks.length / 12));
  const name = CHANNEL_LABEL[channel] ?? channel;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{name}</span>
        <span className="text-ink-muted">
          {total} {total === 1 ? "lead" : "leads"}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${name}: ${total} leads over ${weeks.length} weeks, peaking at ${best?.byChannel[channel] ?? 0} in the week of ${best ? formatDate(`${best.weekStart}T00:00:00Z`) : "—"}.`}
        className="border-line flex items-end gap-1.5 border-b pt-5"
        style={{ height: CHART_H }}
      >
        {weeks.map((w) => {
          const n = w.byChannel[channel] ?? 0;
          const days = daysOf(w.weekStart);
          return (
            <div
              key={w.weekStart}
              title={`Week of ${formatDate(`${w.weekStart}T00:00:00Z`)}: ${n} ${n === 1 ? "lead" : "leads"}${days < 7 ? ` (part week: ${days} of 7 days in range)` : ""}`}
              className="flex h-full min-w-0 flex-1 items-end justify-center"
            >
              {/* Anchored to the baseline, so a tall column means more leads
                  and nothing floats. A zero week draws no column at all. */}
              {n > 0 && (
                <div
                  className="relative w-full max-w-12 rounded-t-[4px]"
                  style={{
                    height: `${peak > 0 ? (n / peak) * 100 : 0}%`,
                    // A part week is paler, so it is not read beside a
                    // whole one as a drop. The fill alone, so the number
                    // on top keeps its full ink.
                    backgroundColor:
                      days < 7
                        ? "color-mix(in srgb, var(--lead-blue) 55%, transparent)"
                        : "var(--lead-blue)",
                  }}
                >
                  {(labelAll || w === best) && (
                    <span className="text-ink absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-xs font-medium tabular-nums">
                      {n}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex gap-1.5">
        {weeks.map((w, i) => {
          const days = daysOf(w.weekStart);
          return (
            <span
              key={w.weekStart}
              className="text-ink-muted flex min-w-0 flex-1 flex-col items-center text-center text-xs"
            >
              <span className="w-full truncate">
                {i % every === 0 ? shortDay(w.weekStart) : ""}
              </span>
              {days < 7 && (
                <span className="w-full truncate">
                  {days} {days === 1 ? "day" : "days"}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function LeadsOverTimePanel({
  data,
  from,
  to,
}: {
  data: AdsWeeks;
  // The report's range, so a week it cuts short is marked as one.
  from: string;
  to: string;
}) {
  const { channels, weeks, peak } = data;
  const daysOf = (weekStart: string) => daysInRange(weekStart, from, to);
  const partWeeks = weeks.some((w) => daysOf(w.weekStart) < 7);
  const grand = weeks.reduce((n, w) => n + w.total, 0);

  return (
    <PanelCard
      eyebrow="TREND"
      title={
        <>
          Meta leads per week{" "}
          <span className="text-ink-muted font-normal">({grand} in range)</span>
        </>
      }
      description={
        <>
          Weeks start on Monday, Malaysia time. One chart per Meta platform, all
          on the same scale, so a tall column means the same number in each.
          {partWeeks &&
            " A paler column is a part week: the date range covers only the days written under it."}
        </>
      }
    >
      {grand === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No Meta leads were captured in this date range.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised flex flex-col gap-6 rounded-md border p-4">
            {channels.map((channel) => (
              <Facet
                key={channel}
                channel={channel}
                weeks={weeks}
                peak={peak}
                daysOf={daysOf}
              />
            ))}
          </div>

          <Figures>
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week of</TableHead>
                    {channels.map((c) => (
                      <TableHead key={c}>{CHANNEL_LABEL[c] ?? c}</TableHead>
                    ))}
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeks.map((w) => (
                    <TableRow key={w.weekStart}>
                      <TableCell>
                        {formatDate(`${w.weekStart}T00:00:00Z`)}
                        {daysOf(w.weekStart) < 7 &&
                          ` (${daysOf(w.weekStart)} days in range)`}
                      </TableCell>
                      {channels.map((c) => (
                        <TableCell key={c}>{w.byChannel[c] ?? 0}</TableCell>
                      ))}
                      <TableCell>{w.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          </Figures>
        </>
      )}
    </PanelCard>
  );
}
