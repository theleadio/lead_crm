// Reads `meta_ad_insight` — Shawn's daily Meta pull, migration 014 — into the
// row shape the §9.18 spend arithmetic already works in.
//
// That table is deliberately flat: one row per ad per day, names copied from
// Meta as they were on the day. §5 still defers `campaign`, `ad` and
// `ad_metric_daily` to January; this is the one table that lets spend be read
// today, and when those three arrive they are loaded from it.
//
// Every row here is ad-level — `adName` is never null — because the pull asks
// Meta for `level: "ad"`. Campaign totals are summed from these rows with
// `byCampaign(rows, "ad")`; there is no second grain to double-count against.

import { requireReportReader } from "./ads.ts";
import type { Viewer } from "../auth/permissions.ts";
import { db } from "../sql.ts";
import type { AdsReportQuery } from "../validation/report.ts";
import type { AdObjective, AdSpendRow } from "./spend.ts";

// One row of the table, as postgres hands it back.
export type MetaAdInsightRow = {
  day: string | Date;
  campaign_id: string;
  campaign_name: string;
  ad_name: string;
  objective: string | null;
  currency: string;
  spend: string;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  messages: number;
  checkouts: number;
  url_tags: string | null;
};

// Meta reports a day in the ad account's timezone, and the account is set to
// Kuala Lumpur, so `day` is already the §4 day this report ranges on — no
// conversion, and none hidden.
function ymd(day: string | Date): string {
  return day instanceof Date
    ? day.toISOString().slice(0, 10)
    : day.slice(0, 10);
}

// Meta's objective, as the account actually reports it, mapped to what the
// report splits spend by. The names come from the live account: OUTCOME_SALES,
// OUTCOME_ENGAGEMENT, OUTCOME_LEADS and OUTCOME_AWARENESS, with the older
// pre-ODAX names kept because old campaigns keep theirs.
//
// Anything unrecognised, and a row Meta sent no objective for, is `other` —
// the bucket that keeps the total honest, never a guess at which it meant.
const OBJECTIVE_BUCKET: Record<string, AdObjective> = {
  OUTCOME_ENGAGEMENT: "whatsapp",
  MESSAGES: "whatsapp",
  OUTCOME_SALES: "conversion",
  CONVERSIONS: "conversion",
  PRODUCT_CATALOG_SALES: "conversion",
  OUTCOME_LEADS: "lead_form",
  LEAD_GENERATION: "lead_form",
  OUTCOME_AWARENESS: "awareness",
  BRAND_AWARENESS: "awareness",
  REACH: "awareness",
  OUTCOME_TRAFFIC: "other",
  LINK_CLICKS: "other",
};

export function objectiveBucket(objective: string | null): AdObjective {
  if (!objective) return "other";
  return OBJECTIVE_BUCKET[objective.trim().toUpperCase()] ?? "other";
}

// Kept for the leads that carry a campaign *name* and no id — older rows,
// and anything that arrived before the SalesProcess import. The id is the
// join key now, so this is a fallback, not the path.
//
// `+` is a space in a query string, `%20` is a space, and the case the
// browser sent is not ours to trust. A tag with a literal campaign in it
// (no macro) is used as written.
export function campaignKey(row: {
  campaign_name: string;
  url_tags: string | null;
}): string {
  const tagged = utmCampaignFromTags(row.url_tags);
  return normaliseCampaign(tagged ?? row.campaign_name);
}

export function utmCampaignFromTags(tags: string | null): string | null {
  if (!tags) return null;
  const value = new URLSearchParams(tags).get("utm_campaign");
  if (!value) return null;
  // `{{campaign.name}}` is a macro Meta fills in at click time, not a value.
  return /^\{\{.*\}\}$/.test(value.trim()) ? null : value;
}

export function normaliseCampaign(name: string): string {
  let decoded = name.replace(/\+/g, " ");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A stray percent sign is not an encoding; keep what was sent.
  }
  return decoded.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toAdSpendRow(row: MetaAdInsightRow): AdSpendRow {
  return {
    metricDate: ymd(row.day),
    // Meta's campaign id is the key both halves group on. The lead carries
    // it (SalesProcess attribution), the ad row carries it, and unlike the
    // name it is not retyped per run or cased differently between them.
    campaignName: row.campaign_id,
    displayName: row.campaign_name,
    adName: row.ad_name,
    objective: objectiveBucket(row.objective),
    // Carried, never assumed: `totalsOf` refuses to add two currencies, and
    // a report that silently added USD to MYR is the kind of number that gets
    // quoted in a meeting.
    currency: row.currency,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    // Ads Manager quotes the link click-through rate, so the report does too;
    // every click is kept beside it rather than thrown away.
    linkClicks: row.inline_link_clicks,
    messages: row.messages,
    checkouts: row.checkouts,
  };
}

export async function adSpendRows(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<AdSpendRow[]> {
  // Same gate as every other read on this screen: the §6 matrix has no
  // Reports row, so the report rides on person read, and the part_time
  // assigned-only kind of read does not open a spend total over every
  // campaign (O62).
  requireReportReader(viewer);
  const sql = db();

  // Whole days, both ends inclusive, like the rest of §9.18. No row cap: this
  // is one row per ad per day for one ad account, and it is summed before
  // anything is drawn — a cap would quietly change a total.
  // The table is keyed (ad_id, day) per account, so a second ad account — a
  // demo seed, a client account, a second brand — would be summed into the
  // same totals. META_AD_ACCOUNT_ID is the account this report is about; with
  // it unset every account is counted, which is right only while there is one.
  const account = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");

  const rows = await sql<MetaAdInsightRow[]>`
    SELECT day, campaign_id, campaign_name, ad_name, objective, currency, spend,
           impressions, clicks, inline_link_clicks, messages, checkouts,
           url_tags
    FROM meta_ad_insight
    WHERE day >= ${q.from}::date
      AND day <= ${q.to}::date
      ${account ? sql`AND account_id = ${account}` : sql``}
    ORDER BY day ASC, campaign_name ASC, ad_name ASC`;

  return rows.map(toAdSpendRow);
}
