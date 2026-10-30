import { EmptyRow, TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AdsCampaignRow,
  AdsSourceRow,
  AdsTable,
} from "@/lib/reports/types";

// §9.18: the two report tables. Plain counts, no chart — a chart would be the
// §9.0 reasoning (dashboards live in the BI tool) for far more code.

// A spend cell is an em dash until the ad data exists, never a zero: a zero
// spend reads as a free campaign, and a cost per lead divided from it would
// be a number nobody typed.
function Unavailable() {
  return (
    <TableCell className="text-ink-muted" aria-label="not available yet">
      —
    </TableCell>
  );
}

// The leads that carry no campaign or source are a row of their own, so the
// rows add up to the total. Saying so beats an empty cell that reads as a bug.
function Missing({ what }: { what: string }) {
  return <span className="text-ink-muted italic">No {what}</span>;
}

function Dropped({ table }: { table: AdsTable<unknown> }) {
  if (table.dropped === 0) return null;
  return (
    <p className="text-ink-muted text-sm">
      Showing the {table.rows.length} largest — {table.dropped} more not shown.
    </p>
  );
}

const CAMPAIGN_COLUMNS = 9;

export function CampaignTable({ table }: { table: AdsTable<AdsCampaignRow> }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">
        By campaign{" "}
        <span className="text-ink-muted font-normal">
          ({table.total} {table.total === 1 ? "lead" : "leads"})
        </span>
      </h2>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>First touch</TableHead>
              <TableHead>Later touch</TableHead>
              <TableHead>People</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Impressions</TableHead>
              <TableHead>Clicks</TableHead>
              <TableHead>Cost per lead</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.length === 0 ? (
              <EmptyRow columns={CAMPAIGN_COLUMNS}>
                No Meta leads were captured in this date range.
              </EmptyRow>
            ) : (
              table.rows.map((row) => (
                <TableRow key={row.campaign ?? "__none__"}>
                  <TableCell>
                    {row.campaign ?? <Missing what="campaign" />}
                  </TableCell>
                  <TableCell>{row.leads}</TableCell>
                  <TableCell>{row.firstTouch}</TableCell>
                  <TableCell>{row.laterTouch}</TableCell>
                  <TableCell>{row.people}</TableCell>
                  <Unavailable />
                  <Unavailable />
                  <Unavailable />
                  <Unavailable />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <Dropped table={table} />
    </section>
  );
}

const SOURCE_COLUMNS = 6;

export function SourceTable({ table }: { table: AdsTable<AdsSourceRow> }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">
        By source{" "}
        <span className="text-ink-muted font-normal">
          ({table.total} {table.total === 1 ? "lead" : "leads"})
        </span>
      </h2>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>By channel</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Impressions</TableHead>
              <TableHead>Clicks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.length === 0 ? (
              <EmptyRow columns={SOURCE_COLUMNS}>
                No Meta leads were captured in this date range.
              </EmptyRow>
            ) : (
              table.rows.map((row) => (
                <TableRow key={row.source ?? "__none__"}>
                  <TableCell>
                    {row.source ?? <Missing what="source" />}
                  </TableCell>
                  <TableCell>{row.leads}</TableCell>
                  <TableCell className="text-ink-muted">
                    {row.byChannel
                      .map((c) => `${c.channel} ${c.leads}`)
                      .join(", ")}
                  </TableCell>
                  <Unavailable />
                  <Unavailable />
                  <Unavailable />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <Dropped table={table} />
    </section>
  );
}
