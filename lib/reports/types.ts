// Shapes for the §9.18 ads report. The lead counts come from `touchpoint`;
// the cost side has no table yet (§5 defers `campaign`, `ad` and
// `ad_metric_daily`), so every spend field is null rather than zero — a zero
// spend reads as a free campaign.
// shortcut: spend stays null until ad_metric_daily and a join key from
// touchpoint to a campaign exist, upgrade when Shawn lands them.

export const SPEND_UNAVAILABLE =
  "Spend, impressions, clicks and cost per lead arrive with the ad data — nothing here is estimated.";

export type AdsSpend = {
  spendMyr: number | null;
  impressions: number | null;
  clicks: number | null;
  costPerLeadMyr: number | null;
};

export const NO_SPEND: AdsSpend = {
  spendMyr: null,
  impressions: null,
  clicks: null,
  costPerLeadMyr: null,
};

// One row per utm_campaign. `campaign` is null for the leads that carry no
// campaign at all; they are a row of their own, never dropped, so the rows
// sum to the total (§9.18).
export type AdsCampaignRow = AdsSpend & {
  campaign: string | null;
  leads: number;
  firstTouch: number;
  laterTouch: number;
  people: number;
};

export type AdsChannelCount = { channel: string; leads: number };

export type AdsSourceRow = AdsSpend & {
  source: string | null;
  leads: number;
  byChannel: AdsChannelCount[];
};

// `total` counts every matching row in range, `dropped` how many rows the
// §14 hundred-row cap left out, so the screen can say so instead of
// silently showing a prefix.
export type AdsTable<Row> = {
  rows: Row[];
  total: number;
  dropped: number;
};

export type AdsReportRange = { from: string; to: string };

// §9.18 leads over time: one row per week in range, with the per-channel
// counts folded in. `weekStart` is a plain YYYY-MM-DD, the Monday of a
// Kuala Lumpur week (§4).
export type AdsWeekRow = {
  weekStart: string;
  total: number;
  byChannel: Record<string, number>;
};

export type AdsWeeks = {
  // The channels present in range, biggest first, so the panels are drawn in
  // a stable order and the smallest channel is not the first thing read.
  channels: string[];
  weeks: AdsWeekRow[];
  // The largest weekly count for any single channel, so the small multiples
  // can share one y scale instead of each inventing its own.
  peak: number;
};

// §9.18 efficiency map, the signups half. Campaign attribution is first
// touch per person (`touchpoint.is_first_touch`): a buyer with two purchases
// credits the campaign that first found them. O30 is what stops this being
// per deal, and the panel says which model it used.
export type CampaignSignups = {
  // Meta's own campaign id, which both the ad rows and the attributed lead
  // carry. The name is for the screen only — it varies in Meta's own data.
  campaignId: string;
  campaign: string | null;
  signups: number;
  hrdcSignups: number;
};
