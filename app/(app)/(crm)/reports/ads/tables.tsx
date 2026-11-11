import { EmptyRow, TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyMyr } from "@/lib/format/money";
import { costPer, type SpendTotals } from "@/lib/reports/spend";
import type {
  AdsCampaignRow,
  AdsSourceRow,
  AdsTable,
} from "@/lib/reports/types";
import { campaignLabel } from "./panels/campaign-label";
import { CHANNEL_LABEL } from "./panels/leads-over-time";
import { PanelCard } from "./panels/panel-card";

// §9.18: the two report tables. Plain counts, no chart — a chart would be the
// §9.0 reasoning (dashboards live in the BI tool) for far more code.

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

const CAMPAIGN_COLUMNS = 8;

export function CampaignTable({
  table,
  spend,
}: {
  table: AdsTable<AdsCampaignRow>;
  // What each campaign cost, keyed by Meta's campaign id — the same key the
  // rows are grouped on. A campaign with no spend recorded, and the row for
  // leads carrying no campaign at all, show an em dash rather than zero.
  // Null when the spend read failed: the dashes then mean "unknown", and the
  // panel says so rather than letting them read as "nothing spent".
  spend: Map<string, SpendTotals> | null;
}) {
  return (
    <PanelCard
      eyebrow="LEADS"
      title={
        <>
          Leads by campaign{" "}
          <span className="text-ink-muted font-normal">
            ({table.total} {table.total === 1 ? "lead" : "leads"})
          </span>
        </>
      }
      description={
        <>
          Every Meta lead in range, by the campaign it came from. First touch is
          the person&apos;s first contact with us; a later touch is the same
          person coming back. Cost per person divides the campaign&apos;s spend
          by the people it reached, not by leads, because one person can be
          recorded twice on the same day.
        </>
      }
    >
      {spend === null && (
        <p className="text-ink-muted text-sm">
          Ad spend could not be read, so the spend, clicks and cost columns are
          blank rather than zero.
        </p>
      )}
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
              <TableHead>Clicks</TableHead>
              <TableHead>Cost per person</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.length === 0 ? (
              <EmptyRow columns={CAMPAIGN_COLUMNS}>
                No Meta leads were captured in this date range.
              </EmptyRow>
            ) : (
              table.rows.map((row) => {
                const totals = row.campaignId
                  ? spend?.get(row.campaignId)
                  : undefined;
                const perLead = totals
                  ? costPer(totals.spend, row.people)
                  : null;
                return (
                  <TableRow key={row.campaignId ?? "__none__"}>
                    <TableCell title={row.campaign ?? undefined}>
                      {row.campaign ? (
                        (row.label ?? campaignLabel(row.campaign))
                      ) : (
                        <Missing what="campaign" />
                      )}
                    </TableCell>
                    <TableCell>{row.leads}</TableCell>
                    <TableCell>{row.firstTouch}</TableCell>
                    <TableCell>{row.laterTouch}</TableCell>
                    <TableCell>{row.people}</TableCell>
                    <TableCell>
                      {totals ? (
                        formatMoneyMyr(totals.spend)
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {totals ? (
                        totals.clicks.toLocaleString("en-MY")
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {perLead ? (
                        formatMoneyMyr(perLead)
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>
      <Dropped table={table} />
    </PanelCard>
  );
}

const SOURCE_COLUMNS = 3;

export function SourceTable({ table }: { table: AdsTable<AdsSourceRow> }) {
  return (
    <PanelCard
      eyebrow="LEADS"
      title={
        <>
          Leads by source{" "}
          <span className="text-ink-muted font-normal">
            ({table.total} {table.total === 1 ? "lead" : "leads"})
          </span>
        </>
      }
      description={
        <>
          The same leads by the Meta platform they came from rather than which
          campaign. Meta reports spend per campaign, not per platform, so spend
          is in the campaign table above.
        </>
      }
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>By channel</TableHead>
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
                      .map(
                        (c) =>
                          `${CHANNEL_LABEL[c.channel] ?? c.channel} ${c.leads}`,
                      )
                      .join(", ")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <Dropped table={table} />
    </PanelCard>
  );
}
