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
import type { AdsWeeks } from "@/lib/reports/types";

// §9.18 leads over time: the page's only time axis. Small multiples — one
// column chart per channel on a shared y scale — rather than one stacked
// column per week.
//
// Why facets and not a stack: three channels would need three fills, and the
// brand has exactly one hue that passes the chart-mark checks (design
// decision 9). Facets need no second hue, and the real question is how a
// channel moved week to week, which a facet answers and a stack buries.

const CHANNEL_LABEL: Record<string, string> = {
  lead_form: "Meta Lead Ads",
  ctwa: "Click to WhatsApp",
  web_form: "Website form",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  referral: "Referral",
  payment_link: "Payment link",
  import: "Import",
};

const ROW_H = 56;
const BAR_W = 14;
const GAP = 4;

function Facet({
  channel,
  weeks,
  peak,
}: {
  channel: string;
  weeks: AdsWeeks["weeks"];
  peak: number;
}) {
  const total = weeks.reduce((n, w) => n + (w.byChannel[channel] ?? 0), 0);
  const width = weeks.length * (BAR_W + GAP);
  // The tallest column in this facet, direct-labelled — one label, not a
  // number on every bar.
  const best = weeks.reduce(
    (b, w) =>
      (w.byChannel[channel] ?? 0) > (b.byChannel[channel] ?? 0) ? w : b,
    weeks[0],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{CHANNEL_LABEL[channel] ?? channel}</span>
        <span className="text-ink-muted">
          {total} {total === 1 ? "lead" : "leads"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${Math.max(width, 1)} ${ROW_H}`}
        className="h-14 w-full"
        preserveAspectRatio="xMinYMax meet"
        role="img"
        aria-label={`${CHANNEL_LABEL[channel] ?? channel}: ${total} leads over ${weeks.length} weeks, peaking at ${best?.byChannel[channel] ?? 0} in the week of ${best ? formatDate(`${best.weekStart}T00:00:00Z`) : "—"}.`}
      >
        {weeks.map((w, i) => {
          const n = w.byChannel[channel] ?? 0;
          // Anchored to the baseline, so a tall column means more leads and
          // nothing floats. A zero week draws no column at all.
          const h = peak > 0 ? Math.round((n / peak) * (ROW_H - 2)) : 0;
          return (
            <g key={w.weekStart}>
              <title>{`Week of ${formatDate(`${w.weekStart}T00:00:00Z`)}: ${n} ${n === 1 ? "lead" : "leads"}`}</title>
              {h > 0 && (
                <rect
                  x={i * (BAR_W + GAP)}
                  y={ROW_H - h}
                  width={BAR_W}
                  height={h}
                  rx="3"
                  fill="var(--lead-blue)"
                />
              )}
            </g>
          );
        })}
        {/* Hairline baseline, solid and one shade off the surface. */}
        <line
          x1="0"
          x2={Math.max(width, 1)}
          y1={ROW_H - 0.5}
          y2={ROW_H - 0.5}
          stroke="var(--line)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

export function LeadsOverTimePanel({ data }: { data: AdsWeeks }) {
  const { channels, weeks, peak } = data;
  const grand = weeks.reduce((n, w) => n + w.total, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">
          Meta leads per week{" "}
          <span className="text-ink-muted font-normal">({grand} in range)</span>
        </h2>
        <p className="text-ink-muted text-sm">
          Kuala Lumpur weeks, starting Monday (§4). One chart per channel, all
          on the same scale, so a tall column means the same number in each.
        </p>
      </div>

      {grand === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No Meta leads were captured in this date range.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised flex flex-col gap-4 rounded-md border p-4">
            {channels.map((channel) => (
              <Facet
                key={channel}
                channel={channel}
                weeks={weeks}
                peak={peak}
              />
            ))}
          </div>

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
        </>
      )}
    </section>
  );
}
