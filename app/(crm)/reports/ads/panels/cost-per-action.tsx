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
import { axisCeiling, type ActionCostRow } from "@/lib/reports/spend";
import { campaignLabel } from "./campaign-label";
import { PanelCard } from "./panel-card";

// §9.18: what one conversation, or one started checkout, cost in each
// campaign. Cheapest at the top, because the ranking is the question.
//
// This is the chart the reference page draws as cost per signup. A signup
// needs a lead matched to a campaign, which the import does not carry yet;
// a conversation and a checkout are counted by Meta inside the campaign, so
// this half is answerable today and says much the same thing about which
// campaigns are efficient.
//
// A shorter bar is better here, which inverts the usual reading, so the
// guides are labelled and the figure sits beside every bar.

export function CostPerActionPanel({
  title,
  description,
  unit,
  guides,
  rows,
  emptyNote,
}: {
  title: string;
  description: string;
  unit: string;
  guides: number[];
  rows: ActionCostRow[];
  emptyNote: string;
}) {
  // One campaign at ten times the rest would flatten every readable bar, so
  // the axis stops at three times the middle campaign and anything past it is
  // drawn cut. The exact figure is beside every bar either way.
  const sorted = rows.map((r) => Number(r.costPer)).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const ceiling = axisCeiling(Math.max(median * 3, ...guides));
  const percent = (value: number) => `${Math.min(value / ceiling, 1) * 100}%`;

  return (
    <PanelCard
      eyebrow="EFFICIENCY"
      title={<>{title}</>}
      description={<>{description}</>}
    >
      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">{emptyNote}</p>
        </div>
      ) : (
        <>
          <div className="border-line bg-surface-raised flex flex-col gap-3 rounded-md border p-4">
            <p className="text-ink-subtle text-xs">
              Shorter is cheaper. Marks at{" "}
              {guides.map((g) => formatMoneyMyr(g)).join(", ")}; bars run to{" "}
              {formatMoneyMyr(ceiling)} and one that goes further is drawn cut.
            </p>

            {rows.map((row) => (
              <div key={row.campaign} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium" title={row.campaign}>
                    {campaignLabel(row.campaign)}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {formatMoneyMyr(row.costPer!)} · {row.count} {unit}
                  </span>
                </div>
                <div className="relative h-4 w-full">
                  {guides.map((guide) => (
                    <span
                      key={guide}
                      aria-hidden="true"
                      className="absolute inset-y-0 w-px"
                      style={{
                        left: percent(guide),
                        backgroundColor: "var(--line-strong)",
                      }}
                    />
                  ))}
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: percent(Number(row.costPer)),
                      backgroundColor: "var(--lead-blue)",
                    }}
                    title={`${row.campaign}: ${formatMoneyMyr(row.costPer!)} per ${unit.replace(/s$/, "")}, ${formatMoneyMyr(row.spend)} over ${row.count}`}
                  />
                  {/* Cut, so a bar that ran off the axis is not read as the
                      longest in the field. */}
                  {Number(row.costPer) > ceiling && (
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

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead className="capitalize">{unit}</TableHead>
                  <TableHead>Each</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`t-${row.campaign}`}>
                    <TableCell title={row.campaign}>
                      {campaignLabel(row.campaign)}
                    </TableCell>
                    <TableCell>{formatMoneyMyr(row.spend)}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>{formatMoneyMyr(row.costPer!)}</TableCell>
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
