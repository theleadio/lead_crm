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
import { formatMoneyMyr } from "@/lib/format/money";
import type { DayTotals } from "@/lib/reports/spend";
import { PanelCard } from "./panel-card";

// §9.18: the day axis the report has been missing. Three facets — what was
// spent, the conversations it started, the checkouts it started — one column
// per day, each facet on its own scale because ringgit and counts share none.
//
// Facets rather than one chart with two axes: a dual-axis chart lets anyone
// draw any story by sliding one scale against the other. Three stacked rows
// answer "did spend move, and did the thing it buys move with it" by letting
// the reader compare shapes, which is the honest version of that question.
//
// One hue throughout (design decision 9). Columns are anchored to the
// baseline, so height is the whole encoding.

const ROW_H = 60;
const GAP = 3;

function Facet({
  title,
  total,
  days,
  valueOf,
  format,
}: {
  title: string;
  total: string;
  days: DayTotals[];
  valueOf: (d: DayTotals) => number;
  format: (n: number) => string;
}) {
  const peak = Math.max(...days.map(valueOf), 0);
  const best = days.reduce(
    (b, d) => (valueOf(d) > valueOf(b) ? d : b),
    days[0]!,
  );
  const width = days.length * (10 + GAP);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-ink-muted">{total}</span>
      </div>
      <svg
        viewBox={`0 0 ${Math.max(width, 1)} ${ROW_H}`}
        className="h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}: ${total} over ${days.length} days, highest on ${formatDate(`${best.day}T00:00:00Z`)} at ${format(valueOf(best))}.`}
      >
        {days.map((d, i) => {
          const value = valueOf(d);
          const h = peak > 0 ? Math.round((value / peak) * (ROW_H - 2)) : 0;
          return (
            <g key={d.day}>
              <title>{`${formatDate(`${d.day}T00:00:00Z`)}: ${format(value)}`}</title>
              {h > 0 && (
                <rect
                  x={i * (10 + GAP)}
                  y={ROW_H - h}
                  width={10}
                  height={h}
                  rx="2"
                  fill="var(--lead-blue)"
                />
              )}
            </g>
          );
        })}
        <line
          x1="0"
          x2={Math.max(width, 1)}
          y1={ROW_H - 0.5}
          y2={ROW_H - 0.5}
          stroke="var(--line)"
          strokeWidth="1"
        />
      </svg>
      {/* The peak is direct-labelled; the rest is in the hover text and the
          table, because a number on every column is a table drawn badly. */}
      <span className="text-ink-subtle text-xs">
        highest {formatDate(`${best.day}T00:00:00Z`)} · {format(valueOf(best))}
      </span>
    </div>
  );
}

export function SpendOverTimePanel({
  days,
  totals,
}: {
  days: DayTotals[];
  totals: { spend: string; messages: number; checkouts: number };
}) {
  return (
    <PanelCard
      eyebrow="TREND"
      title={<>Spend by day</>}
      description={
        <>
          Each column is one day in the ad account&apos;s own timezone, which is
          Kuala Lumpur (§4). The three rows share a day axis but not a scale —
          ringgit and conversations do not belong on one.
        </>
      }
    >
      {days.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No ad spend is recorded in this date range.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised flex flex-col gap-4 rounded-md border p-4">
            <Facet
              title="Spent"
              total={formatMoneyMyr(totals.spend)}
              days={days}
              valueOf={(d) => Number(d.spend)}
              format={(n) => formatMoneyMyr(n)}
            />
            <Facet
              title="Conversations started"
              total={totals.messages.toLocaleString("en-MY")}
              days={days}
              valueOf={(d) => d.messages}
              format={(n) => n.toLocaleString("en-MY")}
            />
            <Facet
              title="Checkouts started"
              total={totals.checkouts.toLocaleString("en-MY")}
              days={days}
              valueOf={(d) => d.checkouts}
              format={(n) => n.toLocaleString("en-MY")}
            />
          </div>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead>Conversations</TableHead>
                  <TableHead>Checkouts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{formatDate(`${d.day}T00:00:00Z`)}</TableCell>
                    <TableCell>{formatMoneyMyr(d.spend)}</TableCell>
                    <TableCell>{d.messages}</TableCell>
                    <TableCell>{d.checkouts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </>
      )}
    </PanelCard>
  );
}
