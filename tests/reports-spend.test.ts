// §9.18 ad-spend arithmetic. Pure functions, no database — the tables do not
// exist yet, so these tests are what the figures mean, fixed now so the
// numbers cannot quietly change when the Meta pull is wired in.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  axisCeiling,
  bubbleRadius,
  byCampaign,
  COST_PER_SIGNUP_GUIDES,
  costPer,
  ctr,
  efficiencyPoints,
  MixedCurrency,
  rankAds,
  roas,
  roasBand,
  roasBothWays,
  roasRows,
  spendByObjective,
  totalsOf,
  type AdSpendRow,
} from "../lib/reports/spend.ts";

const row = (over: Partial<AdSpendRow> = {}): AdSpendRow => ({
  metricDate: "2026-10-01",
  campaignName: "aiauto_202610_leads_en",
  adName: null,
  objective: "conversion",
  currency: "MYR",
  spend: "100.00",
  impressions: 1000,
  clicks: 50,
  linkClicks: 50,
  messages: 0,
  checkouts: 0,
  ...over,
});

// --- the single figures ----------------------------------------------------

test("costPer: spend divided by what it bought, to the cent", () => {
  assert.equal(costPer("3456.00", 2), "1728.00");
  assert.equal(costPer("100.00", 3), "33.33");
  assert.equal(costPer("0.01", 2), "0.01"); // rounds, never truncates to zero
});

// Zero of the thing is no answer. Infinity on a report is a broken panel, and
// a zero cost per signup reads as a free signup.
test("costPer: no count is null, never zero and never infinity", () => {
  assert.equal(costPer("500.00", 0), null);
  assert.equal(costPer("500.00", -1), null);
  assert.equal(costPer("500.00", Number.NaN), null);
});

test("roas: revenue over spend", () => {
  assert.equal(roas("20736.00", "11415.00")?.toFixed(1), "1.8");
  assert.equal(roas("20520.00", "489.00")?.toFixed(1), "42.0");
});

// A campaign that spent nothing did not earn infinitely well.
test("roas: no spend is null, not infinity", () => {
  assert.equal(roas("5000.00", "0.00"), null);
  assert.equal(roas("0.00", "0.00"), null);
});

test("roas: no revenue is zero, which is a real answer", () => {
  assert.equal(roas("0.00", "2712.00"), 0);
});

test("roasBand: the reference's three bands", () => {
  assert.equal(roasBand(7.6), "good");
  assert.equal(roasBand(3), "good"); // the boundary is inside the good band
  assert.equal(roasBand(2.9), "watch");
  assert.equal(roasBand(1.5), "watch");
  assert.equal(roasBand(1.4), "poor");
  assert.equal(roasBand(0), "poor");
  assert.equal(roasBand(null), null);
});

// The caveat the reference page buries in its notes, as arithmetic: grant
// money never reaches Stripe, so card revenue alone understates the campaign.
test("roasBothWays: grant money shows beside card money, never instead of it", () => {
  const both = roasBothWays(
    { stripe: "31104.00", hrdc: "76032.00" },
    "11415.00",
  );
  assert.equal(both.stripe?.toFixed(1), "2.7");
  assert.equal(both.total?.toFixed(1), "9.4");
  assert.ok(both.total! > both.stripe!, "the total can only be the larger");
});

test("ctr: clicks over impressions, and no impressions is null", () => {
  assert.equal(ctr(50, 1000), 0.05);
  assert.equal(ctr(0, 1000), 0);
  assert.equal(ctr(5, 0), null);
});

// --- money exactness -------------------------------------------------------

// §12.7: money is added in cents. A float would make this 0.30000000000000004.
test("money: cents are exact across a sum", () => {
  const rows = [row({ spend: "0.10" }), row({ spend: "0.20" })];
  assert.equal(totalsOf(rows).spend, "0.30");
});

test("money: a large total keeps its cents", () => {
  const rows = Array.from({ length: 3 }, () => row({ spend: "11415.33" }));
  assert.equal(totalsOf(rows).spend, "34245.99");
});

// --- currency --------------------------------------------------------------

// A total that silently adds USD to MYR is the kind of number that gets
// quoted in a meeting. Refused, not summed.
test("currency: mixing currencies throws rather than totalling", () => {
  const rows = [row(), row({ currency: "USD", spend: "50.00" })];
  assert.throws(() => totalsOf(rows), MixedCurrency);
  assert.throws(() => rankAds(rows, "messages"), MixedCurrency);
  assert.throws(() => spendByObjective(rows), MixedCurrency);
});

test("currency: the message names what it found", () => {
  try {
    totalsOf([row({ currency: "SGD" })]);
    assert.fail("expected MixedCurrency");
  } catch (err) {
    assert.ok(err instanceof MixedCurrency);
    assert.deepEqual(err.found, ["SGD"]);
    assert.match(err.message, /adds MYR only/);
  }
});

// --- grain -----------------------------------------------------------------

// Campaign rows and ad rows describe the same spend twice. Adding both would
// double it, so the grain is chosen rather than inferred.
test("grain: campaign rows and ad rows are never added together", () => {
  const rows = [
    row({ spend: "100.00" }),
    row({ spend: "60.00", adName: "video_a" }),
    row({ spend: "40.00", adName: "video_b" }),
  ];
  assert.equal(
    byCampaign(rows, "campaign").get("aiauto_202610_leads_en")!.spend,
    "100.00",
  );
  assert.equal(
    byCampaign(rows, "ad").get("aiauto_202610_leads_en")!.spend,
    "100.00",
  );
});

// --- panel rows ------------------------------------------------------------

test("efficiency: cost per signup, biggest spender first", () => {
  const spend = byCampaign([
    row({ campaignName: "big", spend: "11415.00" }),
    row({ campaignName: "small", spend: "489.00" }),
  ]);
  const points = efficiencyPoints(
    spend,
    new Map([
      ["big", { signups: 91, hrdcSignups: 65 }],
      ["small", { signups: 29, hrdcSignups: 15 }],
    ]),
  );
  assert.deepEqual(
    points.map((p) => [p.campaign, p.costPerSignup]),
    [
      ["big", "125.44"],
      ["small", "16.86"],
    ],
  );
});

// The most useful point on the chart is the campaign that bought nothing.
test("efficiency: spend with no signups is kept, with no cost per signup", () => {
  const points = efficiencyPoints(
    byCampaign([row({ campaignName: "dud", spend: "2712.00" })]),
    new Map(),
  );
  assert.equal(points[0]!.signups, 0);
  assert.equal(points[0]!.costPerSignup, null);
});

test("efficiency: signups with no spend are kept too", () => {
  const points = efficiencyPoints(
    new Map(),
    new Map([["organic", { signups: 12, hrdcSignups: 3 }]]),
  );
  assert.equal(points[0]!.spend, "0.00");
  assert.equal(points[0]!.costPerSignup, null);
});

test("efficiency: the guide lines are the reference's three", () => {
  assert.deepEqual([...COST_PER_SIGNUP_GUIDES], [50, 100, 200]);
});

test("roasRows: banded on card revenue, total shown beside it", () => {
  const rows = roasRows(
    byCampaign([
      row({ campaignName: "grant_heavy", spend: "11415.00" }),
      row({ campaignName: "cash", spend: "489.00" }),
    ]),
    new Map([
      ["grant_heavy", { stripe: "31104.00", hrdc: "76032.00" }],
      ["cash", { stripe: "20520.00", hrdc: "0.00" }],
    ]),
  );
  assert.equal(rows[0]!.campaign, "cash", "highest card ROAS first");
  assert.equal(rows[0]!.band, "good");
  const grant = rows.find((r) => r.campaign === "grant_heavy")!;
  assert.equal(grant.band, "watch");
  assert.ok(grant.totalRoas! > grant.stripeRoas!);
});

test("rankAds: ranked by what was counted, with cost and rate beside it", () => {
  const rows = [
    row({
      adName: "vid_a",
      spend: "300.00",
      messages: 60,
      clicks: 90,
      impressions: 3000,
    }),
    row({
      adName: "vid_b",
      spend: "100.00",
      messages: 80,
      clicks: 40,
      linkClicks: 25,
      impressions: 1000,
    }),
    row({ adName: "vid_c", spend: "100.00", messages: 0 }),
    row({ adName: null, spend: "500.00", messages: 999 }),
  ];
  const ranked = rankAds(rows, "messages");
  assert.deepEqual(
    ranked.map((r) => [r.ad, r.count, r.costPer]),
    [
      ["vid_b", 80, "1.25"],
      ["vid_a", 60, "5.00"],
    ],
  );
  // The rate is link clicks over impressions — 25 of 1000, not the 40 clicks
  // Meta counted in total. Ads Manager quotes the link rate.
  assert.equal(ranked[0]!.ctr, 0.025);
});

test("rankAds: the limit caps the table", () => {
  const rows = Array.from({ length: 15 }, (_, i) =>
    row({ adName: `ad_${i}`, messages: i + 1 }),
  );
  assert.equal(rankAds(rows, "messages").length, 10);
  assert.equal(rankAds(rows, "messages", 3).length, 3);
  assert.equal(rankAds(rows, "messages", 3)[0]!.ad, "ad_14");
});

test("spendByObjective: every objective present, so stacks line up", () => {
  const splits = spendByObjective([
    row({ campaignName: "mix", objective: "whatsapp", spend: "600.00" }),
    row({ campaignName: "mix", objective: "conversion", spend: "400.00" }),
    row({ campaignName: "one", objective: "conversion", spend: "250.00" }),
  ]);
  assert.equal(splits[0]!.campaign, "mix");
  assert.equal(splits[0]!.total, "1000.00");
  assert.deepEqual(splits[0]!.byObjective, {
    whatsapp: "600.00",
    conversion: "400.00",
    lead_form: "0.00",
    awareness: "0.00",
    other: "0.00",
  });
  assert.deepEqual(splits[1]!.byObjective, {
    whatsapp: "0.00",
    conversion: "250.00",
    lead_form: "0.00",
    awareness: "0.00",
    other: "0.00",
  });
});

// An objective we have not mapped keeps its spend in the total rather than
// vanishing from it.
test("spendByObjective: the segments add up to the total", () => {
  const splits = spendByObjective([
    row({ campaignName: "c", objective: "other", spend: "123.45" }),
    row({ campaignName: "c", objective: "whatsapp", spend: "76.55" }),
  ]);
  const parts = Object.values(splits[0]!.byObjective);
  const summed = parts.reduce((n, p) => n + Number(p), 0).toFixed(2);
  assert.equal(summed, Number(splits[0]!.total).toFixed(2));
});

// --- the efficiency map's geometry -----------------------------------------

test("axisCeiling: a round number at or above the data", () => {
  assert.equal(axisCeiling(91), 100);
  assert.equal(axisCeiling(100), 100);
  assert.equal(axisCeiling(101), 200);
  assert.equal(axisCeiling(11415), 20000);
  assert.equal(axisCeiling(2300), 2500);
  // An empty range must not divide by zero when it scales a point.
  assert.equal(axisCeiling(0), 1);
  assert.equal(axisCeiling(-5), 1);
});

// Area-proportional, not radius-proportional: twice the grant seats must look
// twice as big, not four times.
test("bubbleRadius: area carries the count", () => {
  const peak = 64;
  const r = (n: number) => bubbleRadius(n, peak) - 4;
  assert.ok(Math.abs(r(64) / r(16) - 2) < 0.01, "4x the count is 2x the area");
  assert.equal(bubbleRadius(0, peak), 4, "no grant seats still draws a point");
  assert.equal(bubbleRadius(5, 0), 4, "no peak is the smallest radius");
});
