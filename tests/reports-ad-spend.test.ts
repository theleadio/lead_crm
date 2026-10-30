// Mapping `meta_ad_insight` (migration 014) onto the row shape the §9.18
// spend arithmetic works in. Pure — the query is covered by the database
// test beside this one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseCampaign,
  toAdSpendRow,
  utmCampaignFromTags,
  type MetaAdInsightRow,
} from "../lib/reports/ad-spend.ts";
import {
  byCampaign,
  byDay,
  costPerActionByCampaign,
  headlineFigures,
  rankAds,
  spendByObjective,
} from "../lib/reports/spend.ts";

const insight = (over: Partial<MetaAdInsightRow> = {}): MetaAdInsightRow => ({
  day: "2026-10-01",
  campaign_id: "1200000000001",
  campaign_name: "aiauto_202610_leads_en",
  ad_name: "aiauto_202610_leads_en — carousel",
  currency: "MYR",
  objective: "OUTCOME_SALES",
  spend: "120.50",
  impressions: 5500,
  clicks: 100,
  inline_link_clicks: 40,
  messages: 0,
  checkouts: 0,
  url_tags: null,
  ...over,
});

test("carries the money and the counts through untouched", () => {
  const row = toAdSpendRow(insight());
  assert.equal(row.metricDate, "2026-10-01");
  assert.equal(row.campaignName, "1200000000001");
  assert.equal(row.displayName, "aiauto_202610_leads_en");
  assert.equal(row.adName, "aiauto_202610_leads_en — carousel");
  assert.equal(row.spend, "120.50");
  assert.equal(row.impressions, 5500);
  assert.equal(row.clicks, 100);
});

test("a date comes back as a plain day, whatever the driver hands over", () => {
  assert.equal(
    toAdSpendRow(insight({ day: new Date("2026-10-01T00:00:00Z") })).metricDate,
    "2026-10-01",
  );
});

test("currency is carried, never assumed to be MYR", () => {
  assert.equal(toAdSpendRow(insight({ currency: "USD" })).currency, "USD");
});

test("every row is ad-level, so campaign totals sum from the ad grain", () => {
  const rows = [
    insight({ spend: "100.00" }),
    insight({ ad_name: "aiauto_202610_leads_en — video", spend: "50.25" }),
    insight({
      campaign_id: "2",
      campaign_name: "vibe_202610_leads_cn",
      spend: "80.00",
    }),
  ].map(toAdSpendRow);

  assert.equal(
    rows.every((r) => r.adName !== null),
    true,
  );
  // The campaign grain is empty on purpose: 014 has no campaign-level rows,
  // so asking for that grain must return nothing rather than half a total.
  assert.equal(byCampaign(rows, "campaign").size, 0);

  const totals = byCampaign(rows, "ad");
  assert.equal(totals.get("1200000000001")?.spend, "150.25");
  assert.equal(totals.get("2")?.spend, "80.00");
});

// Meta's objective, bucketed. The account reports four of them, and anything
// unmapped — or missing — is `other` rather than a guess.
test("the objective is bucketed, and an unknown one is not guessed at", () => {
  assert.equal(toAdSpendRow(insight()).objective, "conversion");
  assert.equal(
    toAdSpendRow(insight({ objective: "OUTCOME_ENGAGEMENT" })).objective,
    "whatsapp",
  );
  assert.equal(
    toAdSpendRow(insight({ objective: "OUTCOME_LEADS" })).objective,
    "lead_form",
  );
  assert.equal(
    toAdSpendRow(insight({ objective: "OUTCOME_AWARENESS" })).objective,
    "awareness",
  );
  assert.equal(
    toAdSpendRow(insight({ objective: "SOMETHING_NEW" })).objective,
    "other",
  );
  assert.equal(toAdSpendRow(insight({ objective: null })).objective, "other");
});

test("link clicks are carried beside every click, never instead of them", () => {
  const row = toAdSpendRow(insight({ clicks: 100, inline_link_clicks: 40 }));
  assert.equal(row.clicks, 100);
  assert.equal(row.linkClicks, 40);
});

test("an ad that counted nothing is in no ranking", () => {
  const rows = [
    insight(),
    insight({ campaign_id: "2", campaign_name: "ltf_202609_leads_cn" }),
  ].map(toAdSpendRow);
  assert.deepEqual(rankAds(rows, "messages"), []);
  assert.deepEqual(rankAds(rows, "checkouts"), []);
  // Every row is ad-level, so the split has to be told that grain; asked for
  // campaign rows it finds none, which is what stops a double count.
  assert.deepEqual(spendByObjective(rows), []);
  assert.equal(spendByObjective(rows, "ad").length, 2);
});

// Every tagged ad in the account carries utm_campaign={{campaign.name}}, so
// the tag resolves to the campaign's own name at click time. What arrives on
// a touchpoint is that name as a URL carried it.
test("the campaign key is Meta's id; the name is only for the screen", () => {
  const row = toAdSpendRow(
    insight({
      campaign_id: "1200000000009",
      campaign_name: "LEAD | Oct2026 | WhatsApp | AI Vibe Coding",
    }),
  );
  assert.equal(row.campaignName, "1200000000009");
  assert.equal(row.displayName, "LEAD | Oct2026 | WhatsApp | AI Vibe Coding");
});

// Meta cases its own names inconsistently ("WhatsApp" against "Whatsapp") and
// they are retyped per run. Two rows of one campaign stay one campaign.
test("the same campaign id survives the name being cased differently", () => {
  const rows = [
    insight({ campaign_id: "77", campaign_name: "LEAD | WhatsApp | Vibe" }),
    insight({
      campaign_id: "77",
      campaign_name: "LEAD | Whatsapp | Vibe",
      ad_name: "b",
      spend: "10.00",
    }),
  ].map(toAdSpendRow);
  assert.equal(byCampaign(rows, "ad").size, 1);
  assert.equal(byCampaign(rows, "ad").get("77")?.spend, "130.50");
});

test("a macro tag is not mistaken for a campaign name", () => {
  const macro =
    "utm_source=fb_ad&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
  assert.equal(utmCampaignFromTags(macro), null);
});

test("a space is a space however the URL spelled it", () => {
  assert.equal(normaliseCampaign("AI+Vibe%20Coding  KL"), "ai vibe coding kl");
  // A stray percent is not an encoding; what was sent is kept.
  assert.equal(normaliseCampaign("100% Online"), "100% online");
});

// A row is one ad on one day. The ranked tables are of ads over the range.
test("an ad that ran for days is one row, summed", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"].map((day) =>
    toAdSpendRow(
      insight({
        day,
        ad_name: "Info Banner 1 | JB",
        spend: "100.00",
        messages: 10,
        impressions: 1000,
        inline_link_clicks: 20,
      }),
    ),
  );
  const ranked = rankAds(days, "messages");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.count, 30);
  // RM300 over 30 messages, not RM100 over 10.
  assert.equal(ranked[0]!.costPer, "10.00");
  assert.equal(ranked[0]!.ctr, 0.02);
});

test("the same ad name in two campaigns stays two rows", () => {
  const rows = [
    insight({ ad_name: "Info Banner 1", messages: 5 }),
    insight({
      ad_name: "Info Banner 1",
      campaign_id: "2",
      campaign_name: "other campaign",
      messages: 3,
    }),
  ].map(toAdSpendRow);
  assert.equal(rankAds(rows, "messages").length, 2);
});

// The figures the spend side can answer with no attribution at all.
test("headline figures count the account, not the attribution", () => {
  const rows = [
    insight({
      spend: "100.00",
      messages: 10,
      checkouts: 2,
      impressions: 1000,
      inline_link_clicks: 50,
    }),
    insight({
      day: "2026-10-02",
      ad_name: "b",
      spend: "50.00",
      messages: 5,
      impressions: 500,
      inline_link_clicks: 25,
    }),
  ].map(toAdSpendRow);
  const f = headlineFigures(rows);
  assert.equal(f.spend, "150.00");
  assert.equal(f.messages, 15);
  assert.equal(f.checkouts, 2);
  assert.equal(f.costPerMessage, "10.00");
  assert.equal(f.costPerCheckout, "75.00");
  assert.equal(f.linkCtr, 0.05);
  assert.equal(f.days, 2);
  assert.equal(f.ads, 2);
});

test("byDay sums a day across its ads, in date order", () => {
  const rows = [
    insight({ day: "2026-10-02", spend: "20.00", messages: 2 }),
    insight({ day: "2026-10-01", spend: "10.00", messages: 1 }),
    insight({ day: "2026-10-01", ad_name: "b", spend: "5.50", messages: 3 }),
  ].map(toAdSpendRow);
  assert.deepEqual(
    byDay(rows).map((d) => [d.day, d.spend, d.messages]),
    [
      ["2026-10-01", "15.50", 4],
      ["2026-10-02", "20.00", 2],
    ],
  );
});

test("cost per action ranks cheapest first and drops campaigns with none", () => {
  const rows = [
    insight({ campaign_id: "dear", spend: "100.00", messages: 2 }),
    insight({ campaign_id: "cheap", spend: "100.00", messages: 50 }),
    insight({ campaign_id: "silent", spend: "100.00", messages: 0 }),
  ].map(toAdSpendRow);
  assert.deepEqual(
    costPerActionByCampaign(rows, "messages").map((r) => [
      r.campaign,
      r.costPer,
    ]),
    [
      ["cheap", "2.00"],
      ["dear", "50.00"],
    ],
  );
});
