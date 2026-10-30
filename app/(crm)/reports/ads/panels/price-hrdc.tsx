import { TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyMyr } from "@/lib/format/money";
import type { PriceShareRow } from "@/lib/reports/funding";
import { PanelCard } from "./panel-card";

// §9.18 price against HRDC share: the question is where a programme sits, not
// which is biggest, so a scatter. One series, so one hue and no legend — the
// title names it. Every point is direct-labelled by programme, because the
// label is the point's identity rather than a value repeated from the axis.
//
// Hand-written SVG: twenty circles and two axes need no charting dependency,
// and this way the panel server-renders and works with JavaScript off. The
// hover text is a native <title>, which costs nothing.

const WIDTH = 720;
const HEIGHT = 300;
const PAD = { top: 16, right: 24, bottom: 44, left: 56 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// A round number at or above the dearest course, so the axis ticks are
// readable prices rather than whatever the maximum happened to be.
function priceCeiling(rows: PriceShareRow[]): number {
  const max = Math.max(0, ...rows.map((r) => Number(r.listPriceMyr)));
  if (max <= 0) return 1000;
  const step = max > 4000 ? 2000 : max > 1000 ? 1000 : 500;
  return Math.ceil(max / step) * step;
}

export function PriceHrdcPanel({ rows }: { rows: PriceShareRow[] }) {
  const ceiling = priceCeiling(rows);
  const x = (price: number) => PAD.left + (price / ceiling) * PLOT_W;
  const y = (share: number) => PAD.top + (1 - share) * PLOT_H;

  const shareTicks = [0, 0.25, 0.5, 0.75, 1];
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceiling);

  return (
    <PanelCard
      eyebrow="MUST SEE"
      title={<>Course price against HRDC share</>}
      description={
        <>
          Each point is one programme: its list price, and the share of its
          seats in this range that HRDC funded.
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No seats were taken on a priced course in this date range.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised overflow-x-auto rounded-md border p-2">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full min-w-150"
              role="img"
              aria-label={`Scatter of ${rows.length} programmes: list price against HRDC share. The figures are in the table below.`}
            >
              {/* Solid hairline grid, one shade off the surface — never dashed. */}
              {shareTicks.map((t) => (
                <g key={`y${t}`}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + PLOT_W}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--line)"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 10}
                    y={y(t) + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--ink-muted)"
                  >
                    {t * 100}%
                  </text>
                </g>
              ))}
              {priceTicks.map((p) => (
                <text
                  key={`x${p}`}
                  x={x(p)}
                  y={PAD.top + PLOT_H + 20}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--ink-muted)"
                >
                  {p === 0 ? "RM 0" : `RM ${p.toLocaleString("en-MY")}`}
                </text>
              ))}
              <text
                x={PAD.left + PLOT_W / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-subtle)"
              >
                List price
              </text>

              {/* A label on the dearest course would run off the right
                  edge, and two courses at one price land on each other, so a
                  point past the two-thirds mark is labelled to its left and a
                  clash is nudged down a line. The mark never moves. */}
              {(() => {
                const placed: { y: number; left: boolean }[] = [];
                const nudge = (cy: number, left: boolean) => {
                  let dy = 0;
                  while (
                    placed.some(
                      (q) => q.left === left && Math.abs(q.y - (cy + dy)) < 13,
                    )
                  ) {
                    dy += 13;
                  }
                  placed.push({ y: cy + dy, left });
                  return dy;
                };
                return rows.map((row) => {
                  const cx = x(Number(row.listPriceMyr));
                  const cy = y(row.hrdcShare);
                  const toTheLeft = cx > PAD.left + PLOT_W * 0.66;
                  const dy = nudge(cy, toTheLeft);
                  return (
                    <g key={row.course}>
                      <title>
                        {`${row.course}: ${formatMoneyMyr(row.listPriceMyr)}, ${Math.round(row.hrdcShare * 100)}% HRDC of ${row.seats} seats`}
                      </title>
                      {/* A 2px surface ring, so overlapping points stay apart
                        without a border drawn around the mark. */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r="6"
                        fill="var(--lead-blue)"
                        stroke="var(--surface-raised)"
                        strokeWidth="2"
                      />
                      <text
                        x={toTheLeft ? cx - 10 : cx + 10}
                        y={cy + 4 + dy}
                        textAnchor={toTheLeft ? "end" : "start"}
                        fontSize="11"
                        fill="var(--ink-muted)"
                      >
                        {row.course}
                      </text>
                    </g>
                  );
                });
              })()}
            </svg>
          </div>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Programme</TableHead>
                  <TableHead>List price</TableHead>
                  <TableHead>HRDC share</TableHead>
                  <TableHead>Seats</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`t-${row.course}`}>
                    <TableCell>{row.course}</TableCell>
                    <TableCell>{formatMoneyMyr(row.listPriceMyr)}</TableCell>
                    <TableCell>{Math.round(row.hrdcShare * 100)}%</TableCell>
                    <TableCell>{row.seats}</TableCell>
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
