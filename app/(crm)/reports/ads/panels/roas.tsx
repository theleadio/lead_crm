import { TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyMyr, sumMyr } from "@/lib/format/money";
import {
  ROAS_BANDS,
  roas,
  type RoasBand,
  type RoasRow,
} from "@/lib/reports/spend";
import { campaignLabel } from "./campaign-label";
import { Figures, PanelCard } from "./panel-card";

// §9.18 panel 3: return on ad spend, one row per programme.
//
// Bars first, as the agreed dashboard draws them: one bar per campaign, length
// is the ratio, fill is its band. The six measures behind each ratio — spend,
// orders, revenue, the grant share — sit in each bar's hover text and in the
// figures table folded underneath, so nothing is lost to the chart.
//
// Banded on revenue paid through SalesProcess (its checkout), net of refunds
// and credited to each buyer's first campaign. Grant money is invoiced to
// HRDC and never passes through it, so the grant share sits in the next
// column: a programme can read poor here and still have been full.

const BAND_LABEL: Record<RoasBand, string> = {
  good: `${ROAS_BANDS.good}× or more`,
  watch: `${ROAS_BANDS.watch}× to ${ROAS_BANDS.good}×`,
  poor: `under ${ROAS_BANDS.watch}×`,
};

// Soft fills, so a tinted cell reads as a band while the figure on top keeps
// its own ink. Status tokens, because this is a judgement about one number.
const BAND_CELL: Record<RoasBand, { background: string; color: string }> = {
  good: { background: "var(--success-soft)", color: "var(--success)" },
  watch: { background: "var(--warning-soft)", color: "var(--warning)" },
  poor: { background: "var(--danger-soft)", color: "var(--danger)" },
};

function Legend() {
  return (
    <div className="text-ink-muted flex flex-wrap items-center gap-2 text-sm">
      <span>ROAS = SalesProcess revenue ÷ ad spend.</span>
      {(Object.keys(BAND_LABEL) as RoasBand[]).map((band) => (
        <span
          key={band}
          className="rounded-md px-2 py-0.5 text-xs font-semibold"
          style={BAND_CELL[band]}
        >
          {BAND_LABEL[band]}
        </span>
      ))}
    </div>
  );
}

// Solid fills for the bars; the soft ones above are for tinted table cells.
const BAND_FILL: Record<RoasBand, string> = {
  good: "var(--success)",
  watch: "var(--warning)",
  poor: "var(--danger)",
};

function RoasBars({ rows }: { rows: RoasRow[] }) {
  const charted = rows.filter((r) => r.stripeRoas !== null && r.band);
  const peak = Math.max(...charted.map((r) => r.stripeRoas!), 0);
  return (
    <ul className="border-line bg-surface-raised flex flex-col gap-2 rounded-md border p-4">
      {charted.map((row) => (
        <li
          key={row.campaignId ?? row.campaign}
          className="grid grid-cols-[minmax(0,14rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,20rem)_1fr]"
          title={`${row.campaign}\n${row.stripeRoas!.toFixed(1)}× · ${formatMoneyMyr(row.stripeRevenue)} revenue on ${formatMoneyMyr(row.spend)} spend${row.stripeOrders === null ? "" : ` · ${row.stripeOrders} orders`}`}
        >
          <span className="text-ink truncate text-right text-sm">
            {campaignLabel(row.campaign)}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-5 rounded-r-[4px]"
              style={{
                width: `calc((100% - 3.5rem) * ${peak > 0 ? row.stripeRoas! / peak : 0})`,
                minWidth: 2,
                backgroundColor: BAND_FILL[row.band!],
              }}
            />
            <span className="text-ink-muted shrink-0 text-sm tabular-nums">
              {row.stripeRoas!.toFixed(1)}×
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

// What the bars cannot say: the total across them, and what the ratio leaves
// out. Plain text, so it carries no colour of its own.
function Notes({
  rows,
  allSpend,
  hrdcUnread,
}: {
  rows: RoasRow[];
  allSpend: string;
  hrdcUnread: boolean;
}) {
  const revenue = sumMyr(rows.map((r) => r.stripeRevenue));
  const spend = sumMyr(rows.map((r) => r.spend));
  const overall = roas(revenue, spend);
  // The listed campaigns are only those that sold something, so their
  // ratio flatters; the one over every campaign's spend is the honest floor.
  const overAll = roas(revenue, allSpend);
  return (
    <ul className="text-ink-muted list-disc space-y-1 pl-5 text-sm">
      {overall !== null && (
        <li>
          Across these campaigns: {formatMoneyMyr(revenue)} revenue on{" "}
          {formatMoneyMyr(spend)} spend = {overall.toFixed(1)}×.
        </li>
      )}
      {overAll !== null && allSpend !== spend && (
        <li>
          Against all Meta spend in range ({formatMoneyMyr(allSpend)}), the same
          revenue is {overAll.toFixed(1)}×.
        </li>
      )}
      {hrdcUnread && (
        <li>Signups could not be read, so the HRDC share column is blank.</li>
      )}
      <li>
        HRDC seats are paid by the grant, not through SalesProcess, so that
        money is not counted: a grant-heavy programme reads lower than it is.
      </li>
      <li>
        Each buyer is credited to the campaign that first found them. A short
        range can show a campaign near the end of its spend with a large ratio
        on little money.
      </li>
    </ul>
  );
}

export function RoasPanel({
  rows,
  allSpend,
  hrdcUnread,
}: {
  rows: RoasRow[];
  allSpend: string;
  hrdcUnread: boolean;
}) {
  return (
    <PanelCard
      eyebrow="RETURN"
      title={<>Return on ad spend</>}
      description={
        <>
          What buyers paid through SalesProcess, net of refunds, against what
          the campaign that first found them cost. Only campaigns with both
          spend and revenue in range are listed. The grant share sits beside it
          because HRDC seats are invoiced and never pass through SalesProcess.
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No campaign in this date range has both recorded spend and recorded
            revenue.
          </p>
        </div>
      ) : (
        <>
          <Legend />

          <RoasBars rows={rows} />

          <Notes rows={rows} allSpend={allSpend} hrdcUnread={hrdcUnread} />

          <Figures>
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Programme</TableHead>
                    <TableHead>Ad spend</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>ROAS</TableHead>
                    <TableHead>HRDC share of signups</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.campaignId ?? row.campaign}>
                      <TableCell title={row.campaign}>
                        {campaignLabel(row.campaign)}
                      </TableCell>
                      <TableCell>{formatMoneyMyr(row.spend)}</TableCell>
                      <TableCell>
                        {row.stripeOrders ?? (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.stripeRoas === null ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          formatMoneyMyr(row.stripeRevenue)
                        )}
                      </TableCell>
                      <TableCell>
                        {row.stripeRoas === null || row.band === null ? (
                          <span className="text-ink-muted">n/a</span>
                        ) : (
                          <span
                            className="inline-block rounded-md px-2 py-0.5 font-semibold tabular-nums"
                            style={BAND_CELL[row.band]}
                            title={`${BAND_LABEL[row.band]}${row.totalRoas === null ? "" : ` · ${row.totalRoas.toFixed(1)}× with HRDC revenue included`}`}
                          >
                            {row.stripeRoas.toFixed(1)}×
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.hrdcShare ? (
                          <>
                            {row.hrdcShare.hrdc} of {row.hrdcShare.signups} (
                            {share(row.hrdcShare.hrdc, row.hrdcShare.signups)})
                          </>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {row.note ?? ""}
                      </TableCell>
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
