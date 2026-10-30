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
  AD_OBJECTIVES,
  type AdObjective,
  type ObjectiveSplit,
} from "@/lib/reports/spend";

// §9.18 panel 7: where the money went — spend per campaign, split by what the
// ads were for.
//
// Small multiples, one facet per objective, rather than one stacked bar per
// campaign. Three stacked segments would need three categorical fills, and
// the brand has one hue that passes the chart-mark checks (design decision 9,
// the same reason the leads-over-time panel is faceted). A facet needs no
// second hue, every facet shares one scale, and the question people actually
// ask — how much of this campaign went to WhatsApp ads — is read straight off
// a row instead of out of a segment boundary.
//
// Bars are drawn from campaign-level rows only: ad-level rows describe the
// same ringgit at a finer grain, and adding both would double the total.

const OBJECTIVE_LABEL: Record<AdObjective, string> = {
  whatsapp: "Click-to-WhatsApp ads",
  conversion: "Conversion ads",
  other: "Other objectives",
};

// Bar length is a share of the biggest single figure on the panel, so it has
// stopped being money and may go through Number() (§12.7).
function share(amount: string, peak: number): number {
  return peak > 0 ? Number(amount) / peak : 0;
}

function Facet({
  objective,
  rows,
  peak,
}: {
  objective: AdObjective;
  rows: ObjectiveSplit[];
  peak: number;
}) {
  const spent = rows.filter((r) => Number(r.byObjective[objective]) > 0);
  const total = sumMyr(rows.map((r) => r.byObjective[objective]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{OBJECTIVE_LABEL[objective]}</span>
        <span className="text-ink-muted">{formatMoneyMyr(total)}</span>
      </div>

      {spent.length === 0 ? (
        <p className="text-ink-muted text-sm">
          Nothing was spent on these in this date range.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {spent.map((row) => {
            const amount = row.byObjective[objective];
            return (
              <div
                key={`${objective}-${row.campaign}`}
                className="flex items-center gap-3 text-sm"
              >
                <span className="text-ink-muted w-48 shrink-0 truncate">
                  {row.campaign}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className="h-3 rounded-sm"
                    style={{
                      width: `${share(amount, peak) * 100}%`,
                      backgroundColor: "var(--lead-blue)",
                    }}
                    title={`${row.campaign}: ${formatMoneyMyr(amount)} on ${OBJECTIVE_LABEL[objective]}`}
                  />
                  <span className="text-ink-muted shrink-0 tabular-nums">
                    {formatMoneyMyr(amount)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SpendSplitPanel({ rows }: { rows: ObjectiveSplit[] }) {
  // One scale across every facet, so the same bar length means the same
  // ringgit wherever it is read.
  const peak = Math.max(
    0,
    ...rows.flatMap((r) => AD_OBJECTIVES.map((o) => Number(r.byObjective[o]))),
  );
  const grand = sumMyr(rows.map((r) => r.total));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">
          Where the spend went{" "}
          <span className="text-ink-muted font-normal">
            ({formatMoneyMyr(grand)} in range)
          </span>
        </h2>
        <p className="text-ink-muted text-sm">
          Campaign-level spend by ad objective. One chart per objective, all on
          the same scale, so a long bar means the same amount in each.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No ad spend is recorded in this date range.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised flex flex-col gap-5 rounded-md border p-4">
            {AD_OBJECTIVES.map((objective) => (
              <Facet
                key={objective}
                objective={objective}
                rows={rows}
                peak={peak}
              />
            ))}
          </div>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  {AD_OBJECTIVES.map((objective) => (
                    <TableHead key={objective}>
                      {OBJECTIVE_LABEL[objective]}
                    </TableHead>
                  ))}
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`t-${row.campaign}`}>
                    <TableCell>{row.campaign}</TableCell>
                    {AD_OBJECTIVES.map((objective) => (
                      <TableCell key={objective}>
                        {formatMoneyMyr(row.byObjective[objective])}
                      </TableCell>
                    ))}
                    <TableCell>{formatMoneyMyr(row.total)}</TableCell>
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
