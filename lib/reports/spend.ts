// §9.18 ad-spend arithmetic, written before the data exists.
//
// Every function here is pure. Nothing imports the database, because there is
// no table yet: §5 defers `campaign`, `ad` and `ad_metric_daily`, and Shawn
// owns the migration. What this file fixes is the *contract* — the row shape
// the report needs, and what each figure means — so that when the Meta pull
// lands, the work is wiring rather than deciding.
//
// Money is numeric(12,2) carried as strings and added in whole cents (§4,
// §12.7). Nothing goes through Number() until a figure has stopped being
// money and become a ratio.

import { sumMyr } from "../format/money.ts";

// What the reference dashboard splits spend by. `other` keeps the total
// honest when an objective arrives that we have not mapped, instead of
// dropping its spend.
// The live account reports four objectives — engagement, sales, leads and
// awareness — so the split carries four buckets and keeps `other` for an
// objective we have not mapped. Three buckets would have filed the two
// biggest webinars and every awareness campaign under "other", which reads
// as an answer rather than as a bucket nobody chose.
export const AD_OBJECTIVES = [
  "whatsapp",
  "conversion",
  "lead_form",
  "awareness",
  "other",
] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

// One row of whatever Shawn's pull writes. `adName` is null on a
// campaign-level row. `currency` is carried per row and never assumed: Meta
// reports in the ad account's currency, and adding USD to MYR would produce a
// total that looks right and is wrong.
export type AdSpendRow = {
  metricDate: string;
  // The key both halves of the report group on — the campaign as a
  // touchpoint's `utm_campaign` would have carried it, compared the way a URL
  // carried it rather than the way Meta prints it.
  campaignName: string;
  // What Meta calls it, for the screen. Absent on a row that has no separate
  // display form.
  displayName?: string;
  adName: string | null;
  objective: AdObjective;
  currency: string;
  spend: string;
  impressions: number;
  // Every click Meta counted, and the link clicks alone. Ads Manager's CTR is
  // the link one, so a rate shown here is built from `linkClicks` and the two
  // are never added.
  clicks: number;
  linkClicks: number;
  messages: number;
  checkouts: number;
};

export const REPORTING_CURRENCY = "MYR";

// The guide lines the reference draws across its efficiency map: a point
// above a line cost less per signup than the line says.
export const COST_PER_SIGNUP_GUIDES = [50, 100, 200] as const;

// The reference's colour bands. A band is a status, not a series (it says
// good / watch / poor about one number), so it may use the status tokens —
// and it always ships with the ratio as text beside it.
export const ROAS_BANDS = { good: 3, watch: 1.5 } as const;
export type RoasBand = "good" | "watch" | "poor";

export function roasBand(roas: number | null): RoasBand | null {
  if (roas === null) return null;
  if (roas >= ROAS_BANDS.good) return "good";
  if (roas >= ROAS_BANDS.watch) return "watch";
  return "poor";
}

// --- exact money -----------------------------------------------------------

// numeric(12,2) as a string to whole cents. sumMyr already does the parsing
// correctly, so a single-element sum is the cheapest way to normalise.
function cents(amount: string): number {
  const normalised = sumMyr([amount]);
  const negative = normalised.startsWith("-");
  const [whole, fraction] = normalised.replace("-", "").split(".");
  const n = Number(whole) * 100 + Number(fraction);
  return negative ? -n : n;
}

function money(fromCents: number): string {
  const sign = fromCents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(fromCents)).toString().padStart(3, "0");
  return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

// --- the single figures ----------------------------------------------------

// Cost per unit of something counted: per signup, per message, per checkout.
// Zero of the thing is not a cost of zero and not infinity — it is no answer,
// so it is null and the panel shows an em dash. Rounded to the cent, which is
// the smallest money this report can mean.
// Spend of zero is also no answer. In this report spend comes from the ad
// pull, so no spend means none was recorded, not that the signups were free —
// and "RM 0.00 per signup" is read as free.
export function costPer(spend: string, count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const spent = cents(spend);
  if (spent <= 0) return null;
  return money(spent / count);
}

// Return on ad spend. Spend of zero is no answer rather than an infinite
// return: a campaign that spent nothing did not earn infinitely well.
export function roas(revenue: string, spend: string): number | null {
  const spent = cents(spend);
  if (spent <= 0) return null;
  return cents(revenue) / spent;
}

// Grant money never passes through Stripe, so a programme with many HRDC
// seats looks poor on card revenue alone — the caveat the reference page
// carries in its notes. Both figures are returned so neither reading can be
// presented as the only one.
export function roasBothWays(
  revenue: { stripe: string; hrdc: string },
  spend: string,
): { stripe: number | null; total: number | null } {
  return {
    stripe: roas(revenue.stripe, spend),
    total: roas(sumMyr([revenue.stripe, revenue.hrdc]), spend),
  };
}

// Click-through rate as a fraction. No impressions is no rate, not zero.
export function ctr(clicks: number, impressions: number): number | null {
  if (!Number.isFinite(impressions) || impressions <= 0) return null;
  return clicks / impressions;
}

// --- aggregation -----------------------------------------------------------

export type SpendTotals = {
  spend: string;
  impressions: number;
  clicks: number;
  messages: number;
  checkouts: number;
};

export const NO_TOTALS: SpendTotals = {
  spend: "0.00",
  impressions: 0,
  clicks: 0,
  messages: 0,
  checkouts: 0,
};

// Mixing currencies is refused rather than summed. A total that silently adds
// USD to MYR is the kind of number that gets quoted in a meeting.
export class MixedCurrency extends Error {
  // Assigned in the body, not as a parameter property: Node runs this file by
  // stripping types, and a parameter property is syntax it cannot strip.
  readonly found: string[];

  constructor(found: string[]) {
    super(
      `Rows carry more than one currency (${found.join(", ")}); ` +
        `this report adds ${REPORTING_CURRENCY} only.`,
    );
    this.found = found;
  }
}

function assertOneCurrency(rows: AdSpendRow[]): void {
  const found = [...new Set(rows.map((r) => r.currency))].sort();
  const wrong = found.filter((c) => c !== REPORTING_CURRENCY);
  if (wrong.length > 0) throw new MixedCurrency(found);
}

export function totalsOf(rows: AdSpendRow[]): SpendTotals {
  assertOneCurrency(rows);
  return {
    spend: sumMyr(rows.map((r) => r.spend)),
    impressions: rows.reduce((n, r) => n + r.impressions, 0),
    clicks: rows.reduce((n, r) => n + r.clicks, 0),
    messages: rows.reduce((n, r) => n + r.messages, 0),
    checkouts: rows.reduce((n, r) => n + r.checkouts, 0),
  };
}

// Campaign-level rows and ad-level rows describe the same spend at two
// grains, so adding both would double-count. Pick one grain explicitly.
export function byCampaign(
  rows: AdSpendRow[],
  grain: "campaign" | "ad" = "campaign",
): Map<string, SpendTotals> {
  const wanted = rows.filter((r) =>
    grain === "campaign" ? r.adName === null : r.adName !== null,
  );
  const out = new Map<string, AdSpendRow[]>();
  for (const row of wanted) {
    const list = out.get(row.campaignName) ?? [];
    list.push(row);
    out.set(row.campaignName, list);
  }
  return new Map([...out].map(([name, list]) => [name, totalsOf(list)]));
}

// --- the five panels' rows -------------------------------------------------

export type EfficiencyPoint = {
  // Meta's campaign id — the identity, and what a React key and a label set
  // must use. Two live campaigns can carry the same name (a sales one and a
  // click-to-WhatsApp one for the same class), so the name identifies
  // nothing.
  campaign: string;
  displayName?: string;
  spend: string;
  signups: number;
  hrdcSignups: number;
  costPerSignup: string | null;
};

// Panel 1. Spend on one axis, signups the report already counts on the other.
// A campaign with spend and no signups is kept: that is the single most
// useful point on the chart, and dropping it would flatter the average.
export function efficiencyPoints(
  spend: Map<string, SpendTotals>,
  signups: Map<string, { signups: number; hrdcSignups: number }>,
): EfficiencyPoint[] {
  const names = new Set([...spend.keys(), ...signups.keys()]);
  return [...names]
    .map((campaign) => {
      const money = spend.get(campaign)?.spend ?? "0.00";
      const counted = signups.get(campaign);
      return {
        campaign,
        spend: money,
        signups: counted?.signups ?? 0,
        hrdcSignups: counted?.hrdcSignups ?? 0,
        costPerSignup: costPer(money, counted?.signups ?? 0),
      };
    })
    .sort(
      (a, b) =>
        cents(b.spend) - cents(a.spend) || a.campaign.localeCompare(b.campaign),
    );
}

export type RoasRow = {
  campaign: string;
  spend: string;
  stripeRevenue: string;
  hrdcRevenue: string;
  // How many orders made that revenue, when the source counted them, and
  // the grant share of the programme's signups — both shown beside the ratio
  // so a high one on three orders is not read as a settled fact.
  stripeOrders: number | null;
  hrdcShare: { hrdc: number; signups: number } | null;
  note: string | null;
  stripeRoas: number | null;
  totalRoas: number | null;
  band: RoasBand | null;
};

export type CampaignRevenue = {
  stripe: string;
  hrdc: string;
  orders?: number;
  hrdcShare?: { hrdc: number; signups: number };
  note?: string;
};

// Panel 3. Banded on Stripe revenue, because that is the money that actually
// arrived through the checkout; the total is shown beside it so a grant-heavy
// programme is not read as a failure.
export function roasRows(
  spend: Map<string, SpendTotals>,
  revenue: Map<string, CampaignRevenue>,
): RoasRow[] {
  return (
    [...spend.keys()]
      // A campaign the revenue source says nothing about has no return — it
      // has no figure. Defaulting it to zero earned would band every such
      // campaign as "poor", which is an answer nobody measured.
      .filter((campaign) => revenue.has(campaign))
      .map((campaign) => {
        const money = spend.get(campaign)!.spend;
        const earned = revenue.get(campaign)!;
        const both = roasBothWays(earned, money);
        return {
          campaign,
          spend: money,
          stripeRevenue: earned.stripe,
          hrdcRevenue: earned.hrdc,
          stripeOrders: earned.orders ?? null,
          hrdcShare: earned.hrdcShare ?? null,
          note: earned.note ?? null,
          stripeRoas: both.stripe,
          totalRoas: both.total,
          band: roasBand(both.stripe),
        };
      })
      .sort(
        (a, b) =>
          (b.stripeRoas ?? -1) - (a.stripeRoas ?? -1) ||
          a.campaign.localeCompare(b.campaign),
      )
  );
}

export type AdRankRow = {
  ad: string;
  campaign: string;
  count: number;
  costPer: string | null;
  ctr: number | null;
};

// Panels 4 and 5. Ranked by the thing counted — messages, or checkouts
// started — with the cost of one and the click-through rate beside it. These
// two are tables rather than charts: six measures per row is past what a bar
// can carry.
export function rankAds(
  rows: AdSpendRow[],
  by: "messages" | "checkouts",
  limit = 10,
): AdRankRow[] {
  assertOneCurrency(rows);

  // A row is one ad on one day, so an ad that ran a fortnight arrives
  // fourteen times. This ranks ads over the range, not ad-days: without the
  // fold one ad fills the table with its separate days, and the cost per
  // message is one day's cost rather than what the ad actually cost.
  const ads = new Map<string, AdSpendRow[]>();
  for (const row of rows) {
    if (row.adName === null) continue;
    const key = `${row.campaignName}\u0000${row.adName}`;
    const list = ads.get(key) ?? [];
    list.push(row);
    ads.set(key, list);
  }

  return [...ads.values()]
    .map((days) => {
      const first = days[0]!;
      const count = days.reduce((n, r) => n + r[by], 0);
      return {
        ad: first.adName!,
        campaign: first.campaignName,
        count,
        costPer: costPer(sumMyr(days.map((r) => r.spend)), count),
        // Link clicks, not every click: this is the rate Ads Manager quotes,
        // and a rate built on all clicks reads about twice as high.
        ctr: ctr(
          days.reduce((n, r) => n + r.linkClicks, 0),
          days.reduce((n, r) => n + r.impressions, 0),
        ),
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.ad.localeCompare(b.ad))
    .slice(0, limit);
}

export type ObjectiveSplit = {
  campaign: string;
  total: string;
  byObjective: Record<AdObjective, string>;
};

// Panel 7. Where the money went, per campaign, split by what the ads were
// for. Every objective is present at zero so the segments line up across
// campaigns and the stacks are comparable.
export function spendByObjective(
  rows: AdSpendRow[],
  grain: "campaign" | "ad" = "campaign",
): ObjectiveSplit[] {
  assertOneCurrency(rows);
  const campaigns = new Map<string, AdSpendRow[]>();
  // One grain only, for the reason `byCampaign` gives: campaign rows and ad
  // rows describe the same ringgit, and adding both doubles the total.
  for (const row of rows.filter((r) =>
    grain === "campaign" ? r.adName === null : r.adName !== null,
  )) {
    const list = campaigns.get(row.campaignName) ?? [];
    list.push(row);
    campaigns.set(row.campaignName, list);
  }
  return [...campaigns]
    .map(([campaign, list]) => ({
      campaign,
      total: sumMyr(list.map((r) => r.spend)),
      byObjective: Object.fromEntries(
        AD_OBJECTIVES.map((objective) => [
          objective,
          sumMyr(
            list.filter((r) => r.objective === objective).map((r) => r.spend),
          ),
        ]),
      ) as Record<AdObjective, string>,
    }))
    .sort(
      (a, b) =>
        cents(b.total) - cents(a.total) || a.campaign.localeCompare(b.campaign),
    );
}

// --- plot scales -----------------------------------------------------------
// Scale maths lives here rather than in the panel: it is arithmetic, and a
// .tsx module cannot be loaded by the test runner.

const MIN_R = 4;
const MAX_R = 16;

// A round ceiling at or above the largest value, so an axis is labelled with
// numbers a person would say. Zero or less still returns 1, because a scale
// divides by this.
export function axisCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

// Area-proportional radius: r grows with the square root of the count, so
// four times the grant seats reads as four times the area and not sixteen.
export function bubbleRadius(count: number, peak: number): number {
  if (peak <= 0 || count <= 0) return MIN_R;
  return MIN_R + (MAX_R - MIN_R) * Math.sqrt(count / peak);
}

// --- what the spend side can answer on its own ------------------------------
// These need no attribution: they are the ad account's own numbers, so they
// hold while `touchpoint` has no campaign to join to (O30, and the import).

export type HeadlineFigures = {
  spend: string;
  messages: number;
  checkouts: number;
  costPerMessage: string | null;
  costPerCheckout: string | null;
  impressions: number;
  linkClicks: number;
  linkCtr: number | null;
  campaigns: number;
  ads: number;
  days: number;
};

export function headlineFigures(rows: AdSpendRow[]): HeadlineFigures {
  assertOneCurrency(rows);
  const spend = sumMyr(rows.map((r) => r.spend));
  const messages = rows.reduce((n, r) => n + r.messages, 0);
  const checkouts = rows.reduce((n, r) => n + r.checkouts, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const linkClicks = rows.reduce((n, r) => n + r.linkClicks, 0);
  return {
    spend,
    messages,
    checkouts,
    costPerMessage: costPer(spend, messages),
    costPerCheckout: costPer(spend, checkouts),
    impressions,
    linkClicks,
    linkCtr: ctr(linkClicks, impressions),
    campaigns: new Set(rows.map((r) => r.campaignName)).size,
    ads: new Set(rows.filter((r) => r.adName).map((r) => r.adName)).size,
    days: new Set(rows.map((r) => r.metricDate)).size,
  };
}

export type DayTotals = {
  day: string;
  spend: string;
  messages: number;
  checkouts: number;
};

// One row per day that has any row, in date order. Days the account spent
// nothing on are absent rather than zero: the pull only writes days it has.
export function byDay(rows: AdSpendRow[]): DayTotals[] {
  assertOneCurrency(rows);
  const days = new Map<string, AdSpendRow[]>();
  for (const row of rows) {
    const list = days.get(row.metricDate) ?? [];
    list.push(row);
    days.set(row.metricDate, list);
  }
  return [...days]
    .map(([day, list]) => ({
      day,
      spend: sumMyr(list.map((r) => r.spend)),
      messages: list.reduce((n, r) => n + r.messages, 0),
      checkouts: list.reduce((n, r) => n + r.checkouts, 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export type ActionCostRow = {
  campaign: string;
  spend: string;
  count: number;
  costPer: string | null;
};

// What one conversation, or one started checkout, cost in each campaign.
// Cheapest first — the ranking is the point, and a campaign that counted none
// of the thing is left out rather than shown as infinitely expensive.
export function costPerActionByCampaign(
  rows: AdSpendRow[],
  by: "messages" | "checkouts",
  // Only campaigns that were run for this action. A sales campaign that
  // happened to collect two messages costs "RM 670 a conversation", which is
  // not a fact about its efficiency — it never set out to start one.
  objective?: AdObjective,
): ActionCostRow[] {
  assertOneCurrency(rows);
  const campaigns = new Map<string, AdSpendRow[]>();
  for (const row of rows) {
    if (objective && row.objective !== objective) continue;
    const list = campaigns.get(row.campaignName) ?? [];
    list.push(row);
    campaigns.set(row.campaignName, list);
  }
  return [...campaigns]
    .map(([campaign, list]) => {
      const spend = sumMyr(list.map((r) => r.spend));
      const count = list.reduce((n, r) => n + r[by], 0);
      return { campaign, spend, count, costPer: costPer(spend, count) };
    })
    .filter((r) => r.costPer !== null)
    .sort(
      (a, b) =>
        Number(a.costPer) - Number(b.costPer) ||
        a.campaign.localeCompare(b.campaign),
    );
}
