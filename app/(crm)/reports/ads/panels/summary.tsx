import { formatMoneyMyr } from "@/lib/format/money";
import type { HeadlineFigures } from "@/lib/reports/spend";
import { PanelCard } from "./panel-card";

// §9.18, the figures at the top: what the account spent in this range and
// what it got for it. Not a chart — five numbers do not need marks, and a bar
// chart of unrelated measures compares things that share no scale.
//
// Every tile is a measured number with its unit, and a tile whose figure has
// no answer shows an em dash rather than a zero: no conversations is not a
// cost of nothing.
//
// These are the ad account's own counts, so they stand whether or not a lead
// can be matched to a campaign — which is why they lead the page while the
// attribution half waits.

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="border-line bg-surface-raised flex flex-col gap-1 rounded-md border p-4">
      <span className="text-ink-muted text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-ink-subtle text-xs">{note}</span>}
    </div>
  );
}

export function SummaryPanel({
  figures,
  from,
  to,
}: {
  figures: HeadlineFigures;
  from: string;
  to: string;
}) {
  const {
    spend,
    messages,
    checkouts,
    costPerMessage,
    costPerCheckout,
    linkCtr,
    campaigns,
    ads,
    days,
  } = figures;
  // Both cost tiles divide *all* spend, including campaigns that never aimed
  // at that action — the per-campaign panels below are where a fair cost per
  // campaign is read. Saying so on the tile keeps the headline honest.

  return (
    <PanelCard
      eyebrow="OVERVIEW"
      title={
        <>
          The ad account, {from} to {to}
        </>
      }
      description={
        <>
          {campaigns} {campaigns === 1 ? "campaign" : "campaigns"}, {ads}{" "}
          {ads === 1 ? "ad" : "ads"}, {days} {days === 1 ? "day" : "days"} with
          recorded spend
          {linkCtr === null
            ? ""
            : `, ${(linkCtr * 100).toFixed(2)}% link click-through`}
          . Meta&apos;s own counts — they do not depend on a lead being matched
          to a campaign.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Spent" value={formatMoneyMyr(spend)} />
        <Tile
          label="Conversations"
          value={messages.toLocaleString("en-MY")}
          note="click-to-WhatsApp, started"
        />
        <Tile
          label="Per conversation"
          value={costPerMessage ? formatMoneyMyr(costPerMessage) : "—"}
          note="all spend ÷ conversations"
        />
        <Tile
          label="Checkouts started"
          value={checkouts.toLocaleString("en-MY")}
          note="not payments"
        />
        <Tile
          label="Per checkout"
          value={costPerCheckout ? formatMoneyMyr(costPerCheckout) : "—"}
          note="all spend ÷ checkouts"
        />
      </div>
    </PanelCard>
  );
}
