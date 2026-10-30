import { TableCard } from "@/components/list-kit";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyMyr } from "@/lib/format/money";
import {
  axisCeiling,
  ROAS_BANDS,
  type RoasBand,
  type RoasRow,
} from "@/lib/reports/spend";

// §9.18 panel 3: return on ad spend, one bar per campaign.
//
// A bar, because the question is which campaign returned most — a magnitude
// ranked against its neighbours. Sorted by the figure the bar draws, so the
// order and the length say the same thing.
//
// The fill is a status and not a series: good / watch / poor is a judgement
// about one number against ROAS_BANDS, so it may use the status tokens. It
// never rests on colour — every row carries the ratio as text and a labelled
// badge, and the table below repeats both without any colour at all.
//
// Banded on Stripe revenue, with the grant-inclusive figure beside it: HRDC
// money never passes through the checkout, so a grant-heavy programme reads
// as a failure on card revenue alone (O30 — see the caveat below the chart).

const BAND_LABEL: Record<RoasBand, string> = {
  good: `${ROAS_BANDS.good}× or better`,
  watch: `${ROAS_BANDS.watch}× to ${ROAS_BANDS.good}×`,
  poor: `under ${ROAS_BANDS.watch}×`,
};

const BAND_FILL: Record<RoasBand, string> = {
  good: "var(--success)",
  watch: "var(--warning)",
  poor: "var(--danger)",
};

const BAND_VARIANT = {
  good: "success",
  watch: "warning",
  poor: "destructive",
} as const;

function formatRoas(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}×`;
}

// One campaign returning forty times what it cost and the rest returning two
// would flatten every other bar to a sliver. So the axis stops at the rest of
// the field when the best is far clear of it, and the bar that runs past the
// end is cut — the ratio beside it is always the exact one, and the cut mark
// says the length stopped being comparable there.
const RUNAWAY = 3;

function roasAxisTop(rows: RoasRow[]): number {
  const ranked = rows
    .map((r) => r.stripeRoas)
    .filter((n): n is number => n !== null)
    .sort((a, b) => b - a);
  const [best = 0, next = 0] = ranked;
  const top = next > 0 && best > next * RUNAWAY ? next : best;
  // Never below the good band, or the thresholds would fall off the track.
  return Math.max(top, ROAS_BANDS.good);
}

function Legend() {
  return (
    <div className="text-ink-muted flex flex-wrap items-center gap-4 text-sm">
      {(Object.keys(BAND_LABEL) as RoasBand[]).map((band) => (
        <span key={band} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-sm"
            style={{ backgroundColor: BAND_FILL[band] }}
          />
          {BAND_LABEL[band]}
        </span>
      ))}
    </div>
  );
}

export function RoasPanel({ rows }: { rows: RoasRow[] }) {
  const ceiling = axisCeiling(roasAxisTop(rows));
  const percent = (roas: number) => `${Math.min(roas / ceiling, 1) * 100}%`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Return on ad spend</h2>
        <p className="text-ink-muted text-sm">
          Stripe revenue divided by what the campaign spent. A campaign that
          spent nothing has no return rather than an infinite one, and shows an
          em dash. The bars run to {ceiling}×; one that goes further is drawn
          cut, with its exact ratio beside it.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No campaign in this date range has both recorded spend and revenue.
          </p>
        </div>
      ) : (
        <>
          <Legend />

          <div className="border-line bg-surface-raised flex flex-col gap-3 rounded-md border p-4">
            {rows.map((row) => (
              <div key={row.campaign} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{row.campaign}</span>
                  <span className="text-ink-muted flex items-center gap-2">
                    <span>{formatRoas(row.stripeRoas)} Stripe</span>
                    {row.band && (
                      <Badge variant={BAND_VARIANT[row.band]}>
                        {BAND_LABEL[row.band]}
                      </Badge>
                    )}
                  </span>
                </div>

                {/* The two thresholds are drawn across the track as solid
                    hairlines, so a bar is read against the band it is in
                    rather than against its neighbours alone. */}
                <div className="bg-surface-raised relative h-5 w-full">
                  {([ROAS_BANDS.watch, ROAS_BANDS.good] as const).map(
                    (mark) => (
                      <span
                        key={mark}
                        aria-hidden="true"
                        className="absolute inset-y-0 w-px"
                        style={{
                          left: percent(mark),
                          backgroundColor: "var(--line-strong)",
                        }}
                      />
                    ),
                  )}
                  {row.stripeRoas !== null && row.band && (
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: percent(row.stripeRoas),
                        backgroundColor: BAND_FILL[row.band],
                      }}
                      title={`${row.campaign}: ${formatRoas(row.stripeRoas)} on ${formatMoneyMyr(row.spend)} spent`}
                    />
                  )}
                  {/* The break mark: two surface slashes across the end of a
                      bar the axis could not hold, so its length is read as
                      cut rather than as the longest in the field. */}
                  {(row.stripeRoas ?? 0) > ceiling && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 right-0 w-3"
                      style={{
                        background:
                          "repeating-linear-gradient(115deg, transparent 0 3px, var(--surface-raised) 3px 5px)",
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-ink-muted text-sm">
            Grant money is invoiced to HRDC rather than taken at the checkout,
            so the Stripe figure understates a grant-heavy programme. The table
            carries the grant-inclusive ratio beside it. Revenue is credited to
            the campaign of the buyer&apos;s first touch, per person, because a
            deal does not record the touchpoint that created it (O30).
          </p>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Spend</TableHead>
                  <TableHead>Stripe revenue</TableHead>
                  <TableHead>HRDC revenue</TableHead>
                  <TableHead>Stripe ROAS</TableHead>
                  <TableHead>Including HRDC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`t-${row.campaign}`}>
                    <TableCell>{row.campaign}</TableCell>
                    <TableCell>{formatMoneyMyr(row.spend)}</TableCell>
                    <TableCell>{formatMoneyMyr(row.stripeRevenue)}</TableCell>
                    <TableCell>{formatMoneyMyr(row.hrdcRevenue)}</TableCell>
                    <TableCell>{formatRoas(row.stripeRoas)}</TableCell>
                    <TableCell>{formatRoas(row.totalRoas)}</TableCell>
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
