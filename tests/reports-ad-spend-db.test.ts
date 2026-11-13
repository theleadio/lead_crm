// The spend read over `meta_ad_insight` (migration 014). Each test rolls
// back. Skipped when DATABASE_URL isn't set, and skipped whole when the
// migration has not been applied — the table is Shawn's and lands with the
// Meta pull, so its absence is a pending migration, not a failing report.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import { adSpendRows } from "../lib/reports/ad-spend.ts";
import { byCampaign } from "../lib/reports/spend.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const hasTable = async () => {
  if (!process.env.DATABASE_URL) return false;
  const [row] = await db()`
    SELECT to_regclass('public.meta_ad_insight') IS NOT NULL AS present`;
  return Boolean(row?.present);
};

const present = await hasTable();

const it = (name: string, fn: () => Promise<void>) =>
  test(
    name,
    {
      skip: !process.env.DATABASE_URL
        ? "no DATABASE_URL"
        : !present && "meta_ad_insight is not in this database (014)",
    },
    () => rollbackAfter(fn),
  );

const RANGE = adsReportQuerySchema.parse({});

async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Report reader', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

// The account the report reads, so the fixture is not filtered out when
// META_AD_ACCOUNT_ID is set (`adSpendRows` strips the act_ prefix).
const ACCOUNT =
  process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "") || "test";

// One ad-day. The campaign name is unique per test so the seeded database's
// own rows can never be mistaken for the fixture's. Returns the campaign id,
// which is what the report keys spend on (63d96e2); the name is display only.
async function newInsight(fields: {
  campaign: string;
  ad: string;
  day: string;
  spend: string;
  clicks?: number;
  currency?: string;
}): Promise<string> {
  const id = `${fields.campaign}-id`;
  await db()`
    INSERT INTO meta_ad_insight
      (ad_id, day, account_id, campaign_id, campaign_name, adset_id,
       adset_name, ad_name, currency, spend, impressions, clicks, leads)
    VALUES (${`${fields.ad}-${fields.day}`}, ${fields.day}::date, ${ACCOUNT},
            ${id}, ${fields.campaign},
            ${`${fields.campaign}-adset`}, 'Test adset', ${fields.ad},
            ${fields.currency ?? "MYR"}, ${fields.spend}, 1000,
            ${fields.clicks ?? 25}, 3)`;
  return id;
}

it("reads the rows in range and leaves the rest", async () => {
  const campaign = `spend_${crypto.randomUUID().slice(0, 8)}`;
  const id = await newInsight({
    campaign,
    ad: `${campaign}__carousel`,
    day: RANGE.from,
    spend: "100.00",
  });
  await newInsight({
    campaign,
    ad: `${campaign}__video`,
    day: RANGE.to,
    spend: "50.25",
  });
  // A day outside the range, which must not be counted.
  await newInsight({
    campaign,
    ad: `${campaign}__old`,
    day: "2020-01-01",
    spend: "999.00",
  });

  const rows = (await adSpendRows(await newUser("marketing"), RANGE)).filter(
    (r) => r.campaignName === id,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.displayName === campaign));
  assert.equal(byCampaign(rows, "ad").get(id)?.spend, "150.25");
});

it("sums in whole cents, never in floating point", async () => {
  const campaign = `cents_${crypto.randomUUID().slice(0, 8)}`;
  let id = "";
  for (const [i, spend] of ["0.10", "0.20"].entries())
    id = await newInsight({
      campaign,
      ad: `${campaign}__${i}`,
      day: RANGE.from,
      spend,
    });

  const rows = (await adSpendRows(await newUser("marketing"), RANGE)).filter(
    (r) => r.campaignName === id,
  );
  assert.equal(byCampaign(rows, "ad").get(id)?.spend, "0.30");
});

it("refuses a part_time reader, who only sees their own people", async () => {
  await assert.rejects(
    () => adSpendRows({ id: crypto.randomUUID(), role: "part_time" }, RANGE),
    PermissionError,
  );
});
