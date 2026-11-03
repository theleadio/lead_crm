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
import { ROAS_BANDS, type RoasBand, type RoasRow } from "@/lib/reports/spend";
import { campaignLabel } from "./campaign-label";
import { PanelCard } from "./panel-card";

// §9.18 panel 3: return on ad spend, one row per programme.
//
// A table, not a chart, which is what the agreed dashboard draws. Six
// measures hang off each ratio — spend, orders, revenue, the ratio itself,
// the grant share and a note saying what the ratio does not cover — and a bar
// carries one of those. The ratio cell is tinted by its band, so the shape of
// the column is still readable at a glance.
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

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export function RoasPanel({ rows }: { rows: RoasRow[] }) {
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
                  <TableRow key={row.campaign}>
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
        </>
      )}
    </PanelCard>
  );
}
