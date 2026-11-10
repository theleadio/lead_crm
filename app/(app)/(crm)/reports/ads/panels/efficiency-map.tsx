import { Figures, PanelCard } from "./panel-card";
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
import { campaignLabel } from "./campaign-label";
import { LABEL_CHAR, labelSlots, textBox, type Slot } from "./label-slots";
import {
  axisCeiling,
  bubbleRadius,
  COST_PER_SIGNUP_GUIDES,
  type EfficiencyPoint,
} from "@/lib/reports/spend";

// §9.18 panel 1: spend against signups, one point per campaign.
//
// The diagonals are the point of the chart. A line is "this many ringgit per
// signup", so a campaign above a line beat it and one below it did not — the
// reader compares positions instead of reading a column of ratios.
//
// Bubble area carries the HRDC count, and area is used rather than radius so
// twice the grant seats look twice as big rather than four times.
//
// One series, so one hue and no legend: the title names it (design decision 9).

const WIDTH = 760;
const HEIGHT = 340;
const PAD = { top: 16, right: 110, bottom: 48, left: 64 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// How many points carry their own label. Every campaign is in the table, and
// every mark has hover text; the chart labels the ones worth reading first,
// because forty labels on one plot is a smear, not a chart.
const LABELLED = 8;

// A y axis counting seats should tick in whole seats. Below a handful, the
// quarter ticks an axis ceiling gives would read "1, 1, 1, 0" — the same
// number three times, rounded.
function signupTicks(max: number): number[] {
  if (max <= 1) return [0, 1];
  if (max <= 6) return Array.from({ length: max + 1 }, (_, i) => i);
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));
}

export function EfficiencyMapPanel({ points }: { points: EfficiencyPoint[] }) {
  const spent = points.filter((p) => Number(p.spend) > 0);
  const totalSignups = points.reduce((n, p) => n + p.signups, 0);
  const maxSpend = axisCeiling(
    Math.max(...points.map((p) => Number(p.spend)), 0),
  );
  const peakSignups = Math.max(...points.map((p) => p.signups), 0);
  const maxSignups =
    peakSignups <= 6 ? Math.max(peakSignups, 1) : axisCeiling(peakSignups);
  const peakHrdc = Math.max(...points.map((p) => p.hrdcSignups), 0);

  const x = (spend: number) => PAD.left + (spend / maxSpend) * PLOT_W;
  const y = (signups: number) => PAD.top + (1 - signups / maxSignups) * PLOT_H;

  // Worked out once and used both to draw and to place labels, so the two
  // can't drift apart.
  const guides = COST_PER_SIGNUP_GUIDES.map((rate, i) => {
    const capped = Math.min(maxSpend / rate, maxSignups);
    const endX = x(capped * rate);
    const endY = y(capped);
    // Steep guides all leave through the top edge within a few pixels of
    // each other, so their labels are stepped down their own line, starting
    // a line below the top rule so it doesn't strike through the first. A
    // guide that leaves through the right edge is labelled at its end.
    const exitsTop = capped === maxSignups;
    const text = `RM ${rate}/signup`;
    const labelX = endX + 6;
    const labelY = endY + (exitsTop ? 14 : 4) + i * 13;
    return {
      rate,
      endX,
      endY,
      text,
      labelX,
      labelY,
      box: textBox(labelX, labelX + text.length * LABEL_CHAR, labelY),
    };
  });
  const dots = spent.map((p) => {
    const r = bubbleRadius(p.hrdcSignups, peakHrdc);
    const cx = x(Number(p.spend));
    const cy = y(p.signups);
    return {
      p,
      r,
      cx,
      cy,
      label: campaignLabel(p.displayName ?? p.campaign),
      // Where a label's text starts on the right, or ends on the left.
      labelAt: { right: cx + r + 4, left: cx - r - 4 },
    };
  });

  return (
    <PanelCard
      eyebrow="MUST SEE"
      title={<>Spend against signups</>}
      description={
        <>
          One point per campaign: what it cost, and the seats it produced.
          Bubble size is the grant-funded share. Signups are credited to the
          campaign of the buyer&apos;s first touch, per person — a buyer with
          two purchases credits that campaign twice (O30).
        </>
      }
    >
      {spent.length === 0 || totalSignups === 0 ? (
        <div className="border-line bg-surface-raised flex flex-col gap-2 rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            {spent.length === 0
              ? "The plot needs recorded ad spend. The signups below are counted and current."
              : "Spend is recorded, but no signup in this range is credited to any of these campaigns — so every point would sit on zero. The figures are below."}
          </p>
        </div>
      ) : (
        <div className="border-line bg-surface-raised overflow-x-auto rounded-md border p-2">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full min-w-160"
            role="img"
            aria-label={`Scatter of ${spent.length} campaigns: ad spend against signups. The figures are in the table below.`}
          >
            {/* Cost-per-signup guides. Solid hairlines, labelled at the end,
                so the diagonal is read as a rate and not as data. */}
            {guides.map((g) => (
              <g key={g.rate}>
                <line
                  x1={x(0)}
                  y1={y(0)}
                  x2={g.endX}
                  y2={g.endY}
                  stroke="var(--line-strong)"
                  strokeWidth="1"
                />
                <text
                  x={g.labelX}
                  y={g.labelY}
                  fontSize="10"
                  fill="var(--ink-subtle)"
                >
                  {g.text}
                </text>
              </g>
            ))}

            {/* Axes: one horizontal rule per quarter, no dashes. */}
            {signupTicks(maxSignups).map((seats) => (
              <g key={`y${seats}`}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + PLOT_W}
                  y1={y(seats)}
                  y2={y(seats)}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 10}
                  y={y(seats) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--ink-muted)"
                >
                  {seats}
                </text>
              </g>
            ))}
            {[0, 0.5, 1].map((f) => (
              <text
                key={`x${f}`}
                x={x(f * maxSpend)}
                y={PAD.top + PLOT_H + 22}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-muted)"
              >
                {formatMoneyMyr(f * maxSpend)}
              </text>
            ))}
            <text
              x={PAD.left + PLOT_W / 2}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--ink-subtle)"
            >
              Ad spend
            </text>
            <text
              x={PAD.left - 46}
              y={PAD.top + PLOT_H / 2}
              fontSize="11"
              fill="var(--ink-subtle)"
              transform={`rotate(-90 ${PAD.left - 46} ${PAD.top + PLOT_H / 2})`}
              textAnchor="middle"
            >
              Signups
            </text>

            {(() => {
              // Campaigns that produced something are the readable part of
              // this chart. The ones on the baseline sit on top of each other
              // — labelling them turns the axis into a smear — so only the
              // two biggest spenders among them are named, which is the point
              // being made about them. Every campaign is still in the table.
              const named = [
                ...dots
                  .filter((d) => d.p.signups > 0)
                  .sort((a, b) => b.p.signups - a.p.signups)
                  .slice(0, LABELLED),
                ...dots
                  .filter((d) => d.p.signups === 0)
                  .sort((a, b) => Number(b.p.spend) - Number(a.p.spend))
                  .slice(0, 2),
              ];
              // Placed in that order, so the campaigns that produced most
              // keep their spot. A label moves at most two lines and stays
              // off every point, the guide labels, the x-axis figures, the
              // y-axis and the right edge (label-slots.ts); one with no room
              // near its point is left off. The ceiling sits just above the
              // top rule, so a point on it can still carry its label.
              const slot = labelSlots(
                {
                  floor: PAD.top + PLOT_H + 8,
                  ceiling: PAD.top - 6,
                  left: PAD.left,
                  right: WIDTH,
                },
                [
                  ...dots.map((d) => ({
                    left: d.cx - d.r,
                    right: d.cx + d.r,
                    top: d.cy - d.r,
                    bottom: d.cy + d.r,
                  })),
                  ...guides.map((g) => g.box),
                ],
              );
              const slots = new Map<string, Slot | null>();
              for (const d of named)
                slots.set(
                  d.p.campaign,
                  slot(d.labelAt, d.cy + 4, d.label.length),
                );

              return dots.map(({ p, r, cx, cy, label, labelAt }) => {
                const s = slots.get(p.campaign);
                return (
                  <g key={p.campaign}>
                    <title>
                      {`${p.displayName ?? p.campaign}: ${formatMoneyMyr(p.spend)}, ${p.signups} signups (${p.hrdcSignups} HRDC)${p.costPerSignup ? `, ${formatMoneyMyr(p.costPerSignup)} per signup` : ""}`}
                    </title>
                    {/* See-through and unringed: campaigns with nearly the
                        same spend and signups overlap, and the overlap then
                        shows brighter instead of one dot cutting a crescent
                        out of the other. 0.55 keeps a lone dot at 3.5:1
                        against the dark card. */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="var(--lead-blue)"
                      fillOpacity="0.55"
                    />
                    {s && (
                      <text
                        x={s.side === "right" ? labelAt.right : labelAt.left}
                        y={cy + 4 + s.dy}
                        textAnchor={s.side === "right" ? "start" : "end"}
                        fontSize="10"
                        fill="var(--ink-muted)"
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              });
            })()}
          </svg>
        </div>
      )}

      <Figures>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Signups</TableHead>
                <TableHead>HRDC</TableHead>
                <TableHead>Spend</TableHead>
                <TableHead>Cost per signup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={`t-${p.campaign}`}>
                  <TableCell title={p.campaign}>
                    {p.displayName ?? p.campaign}
                  </TableCell>
                  <TableCell>{p.signups}</TableCell>
                  <TableCell>{p.hrdcSignups}</TableCell>
                  <TableCell>
                    {Number(p.spend) > 0 ? (
                      formatMoneyMyr(p.spend)
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.costPerSignup ? (
                      formatMoneyMyr(p.costPerSignup)
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Figures>
    </PanelCard>
  );
}
