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
import type { AdRankRow } from "@/lib/reports/spend";
import { campaignLabel } from "./campaign-label";
import { PanelCard } from "./panel-card";

// §9.18 panels 4 and 5: the ads that produced the most conversations, and the
// ads that produced the most checkouts.
//
// A ranked table and not a chart. Each row carries four measures — the count,
// what one of them cost, the click-through rate and the campaign it belongs
// to — which is past what a bar can hold, and the question here is "which ads,
// and at what cost", which is read rather than compared by length.
//
// The count still gets a mark: a hairline track behind the number, scaled to
// the top row, so the shape of the ranking is visible without a second chart.
// It is decoration over a figure that is already written, so it carries no
// legend and no axis.

function formatCtr(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

export function TopAdsPanel({
  title: panelTitle,
  description,
  countLabel,
  costLabel,
  rows,
  emptyNote,
}: {
  title: string;
  description: string;
  countLabel: string;
  costLabel: string;
  rows: AdRankRow[];
  emptyNote: string;
}) {
  const peak = Math.max(...rows.map((r) => r.count), 0);

  return (
    <PanelCard
      eyebrow="ADS"
      title={<>{panelTitle}</>}
      description={<>{description}</>}
    >
      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">{emptyNote}</p>
        </div>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>{countLabel}</TableHead>
                <TableHead>{costLabel}</TableHead>
                <TableHead>Click-through rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.campaign}-${row.ad}`}>
                  <TableCell>{row.ad}</TableCell>
                  <TableCell title={row.campaign}>
                    {campaignLabel(row.campaign)}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{row.count}</span>
                      <span
                        aria-hidden="true"
                        className="h-1.5 rounded-sm"
                        style={{
                          width: `${peak > 0 ? (row.count / peak) * 72 : 0}px`,
                          backgroundColor: "var(--lead-blue)",
                        }}
                      />
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.costPer ? (
                      formatMoneyMyr(row.costPer)
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatCtr(row.ctr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </PanelCard>
  );
}
