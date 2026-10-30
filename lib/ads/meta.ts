import { db } from "../sql.ts";

// Pulls daily ad-level numbers from the Meta Marketing API (insights edge) into
// meta_ad_insight (migration 014). Server-only: the token never leaves here.

export type InsightRow = {
  adId: string;
  day: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adName: string;
  currency: string;
  spend: string;
  impressions: number;
  clicks: number;
  leads: number;
  objective: string | null;
  messages: number;
  checkouts: number;
  inlineLinkClicks: number;
  urlTags: string | null;
};

const FIELDS = [
  "account_id",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "account_currency",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "objective",
  "actions",
].join(",");

type Raw = Record<string, unknown> & {
  actions?: { action_type: string; value: string }[];
};

// Meta sends every number as a string and leaves out fields that are zero.
export function mapInsight(r: Raw): InsightRow {
  const s = (k: string) => String(r[k] ?? "");
  const n = (k: string) => Number.parseInt(s(k) || "0", 10);
  const action = (type: string) =>
    Number.parseInt(
      r.actions?.find((a) => a.action_type === type)?.value ?? "0",
      10,
    );
  return {
    adId: s("ad_id"),
    day: s("date_start"),
    accountId: s("account_id"),
    campaignId: s("campaign_id"),
    campaignName: s("campaign_name"),
    adsetId: s("adset_id"),
    adsetName: s("adset_name"),
    adName: s("ad_name"),
    currency: s("account_currency"),
    spend: s("spend") || "0",
    impressions: n("impressions"),
    clicks: n("clicks"),
    leads: action("lead"),
    objective: s("objective") || null,
    messages: action("onsite_conversion.messaging_conversation_started_7d"),
    checkouts: action("offsite_conversion.fb_pixel_initiate_checkout"),
    inlineLinkClicks: n("inline_link_clicks"),
    urlTags: null,
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ponytail: reads the whole window every run and upserts. Fine for one ad
// account at a few hundred ads; add since-last-sync paging if it ever isn't.
export async function fetchInsights(opts: {
  days: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<InsightRow[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || !account)
    throw new Error("META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set");
  const version = process.env.META_GRAPH_VERSION || "v23.0";
  const until = opts.now ?? new Date();
  const since = new Date(until.getTime() - (opts.days - 1) * 86_400_000);
  const act = account.startsWith("act_") ? account : `act_${account}`;

  const q = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: ymd(since), until: ymd(until) }),
    fields: FIELDS,
    limit: "500",
  });
  let url: string | undefined =
    `https://graph.facebook.com/${version}/${act}/insights?${q}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const rows: InsightRow[] = [];
  while (url) {
    // Token in a header, not the URL, so it never lands in a log line.
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      data?: Raw[];
      paging?: { next?: string };
      error?: { message: string; code: number };
    };
    if (!res.ok || body.error)
      throw new Error(
        `Meta API ${res.status}: ${body.error?.message ?? "no body"} (code ${body.error?.code ?? "?"})`,
      );
    for (const r of body.data ?? []) rows.push(mapInsight(r));
    url = body.paging?.next;
  }
  return rows;
}

// url_tags is not an insights field: it sits on the ad's creative, so it is a
// second call, to the ads edge. Returns ad id -> url_tags (null when the ad has
// no creative or no tags).
// effective_status: the ads edge hides archived/deleted ads unless asked, and
// we want tags for historical ad-days too. This list is NOT verified against
// Meta's current docs (written without network access) - check it.
const AD_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
];

export async function fetchUrlTags(opts: {
  fetchImpl?: typeof fetch;
}): Promise<Map<string, string | null>> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || !account)
    throw new Error("META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set");
  const version = process.env.META_GRAPH_VERSION || "v23.0";
  const act = account.startsWith("act_") ? account : `act_${account}`;

  const q = new URLSearchParams({
    fields: "id,creative{url_tags}",
    limit: "500",
    effective_status: JSON.stringify(AD_STATUSES),
  });
  let url: string | undefined =
    `https://graph.facebook.com/${version}/${act}/ads?${q}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const tags = new Map<string, string | null>();
  while (url) {
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      data?: { id: string; creative?: { url_tags?: string } }[];
      paging?: { next?: string };
      error?: { message: string; code: number };
    };
    if (!res.ok || body.error)
      throw new Error(
        `Meta API ${res.status}: ${body.error?.message ?? "no body"} (code ${body.error?.code ?? "?"})`,
      );
    for (const ad of body.data ?? [])
      tags.set(ad.id, ad.creative?.url_tags || null);
    url = body.paging?.next;
  }
  return tags;
}

export async function upsertInsights(rows: InsightRow[]): Promise<number> {
  const sql = db();
  for (const r of rows) {
    await sql`
      INSERT INTO meta_ad_insight
        (ad_id, day, account_id, campaign_id, campaign_name, adset_id,
         adset_name, ad_name, currency, spend, impressions, clicks, leads,
         objective, messages, checkouts, inline_link_clicks, url_tags)
      VALUES
        (${r.adId}, ${r.day}, ${r.accountId}, ${r.campaignId}, ${r.campaignName},
         ${r.adsetId}, ${r.adsetName}, ${r.adName}, ${r.currency}, ${r.spend},
         ${r.impressions}, ${r.clicks}, ${r.leads},
         ${r.objective}, ${r.messages}, ${r.checkouts}, ${r.inlineLinkClicks},
         ${r.urlTags})
      ON CONFLICT (ad_id, day) DO UPDATE SET
        account_id = EXCLUDED.account_id, campaign_id = EXCLUDED.campaign_id,
        campaign_name = EXCLUDED.campaign_name, adset_id = EXCLUDED.adset_id,
        adset_name = EXCLUDED.adset_name, ad_name = EXCLUDED.ad_name,
        currency = EXCLUDED.currency, spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        leads = EXCLUDED.leads, objective = EXCLUDED.objective,
        messages = EXCLUDED.messages, checkouts = EXCLUDED.checkouts,
        inline_link_clicks = EXCLUDED.inline_link_clicks,
        url_tags = COALESCE(EXCLUDED.url_tags, meta_ad_insight.url_tags),
        synced_at = now()`;
  }
  return rows.length;
}
