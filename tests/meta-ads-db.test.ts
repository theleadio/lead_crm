import { after, test } from "node:test";
import assert from "node:assert/strict";
import { upsertInsights, type InsightRow } from "../lib/ads/meta.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const row = (over: Partial<InsightRow> = {}): InsightRow => ({
  adId: `ad-${crypto.randomUUID()}`,
  day: "2026-10-28",
  accountId: "111",
  campaignId: "c1",
  campaignName: "agentic_202610_leads_en",
  adsetId: "s1",
  adsetName: "KL 25-45",
  adName: "Video 1",
  currency: "MYR",
  spend: "12.34",
  impressions: 1000,
  clicks: 25,
  leads: 3,
  objective: "OUTCOME_LEADS",
  messages: 4,
  checkouts: 2,
  inlineLinkClicks: 18,
  urlTags: "utm_source=facebook&utm_campaign=x",
  ...over,
});

const get = async (r: InsightRow) => {
  const [x] = await db()`
    SELECT objective, messages, checkouts, inline_link_clicks, url_tags
    FROM meta_ad_insight WHERE ad_id = ${r.adId} AND day = ${r.day}`;
  return x;
};

it("upsertInsights stores the new columns", async () => {
  const r = row();
  await upsertInsights([r]);
  assert.deepEqual(
    { ...(await get(r)) },
    {
      objective: "OUTCOME_LEADS",
      messages: 4,
      checkouts: 2,
      inline_link_clicks: 18,
      url_tags: "utm_source=facebook&utm_campaign=x",
    },
  );
});

it("a second upsert of the same ad and day updates counts and objective", async () => {
  const r = row();
  await upsertInsights([r]);
  await upsertInsights([
    {
      ...r,
      objective: "MESSAGES",
      messages: 9,
      checkouts: 5,
      inlineLinkClicks: 30,
    },
  ]);
  const x = await get(r);
  assert.equal(x.objective, "MESSAGES");
  assert.equal(x.messages, 9);
  assert.equal(x.checkouts, 5);
  assert.equal(x.inline_link_clicks, 30);
});

it("a null urlTags keeps the earlier url_tags", async () => {
  const r = row();
  await upsertInsights([r]);
  await upsertInsights([{ ...r, urlTags: null }]);
  assert.equal((await get(r)).url_tags, "utm_source=facebook&utm_campaign=x");
});

it("a new urlTags replaces the earlier one", async () => {
  const r = row();
  await upsertInsights([r]);
  await upsertInsights([{ ...r, urlTags: "utm_source=ig" }]);
  assert.equal((await get(r)).url_tags, "utm_source=ig");
});

it("the three counters default to 0, objective and url_tags to NULL", async () => {
  const id = `ad-${crypto.randomUUID()}`;
  const [x] = await db()`
    INSERT INTO meta_ad_insight
      (ad_id, day, account_id, campaign_id, campaign_name, adset_id,
       adset_name, ad_name, currency, spend, impressions, clicks)
    VALUES (${id}, '2026-10-28', '1', 'c', 'c', 's', 's', 'a', 'MYR', 0, 0, 0)
    RETURNING messages, checkouts, inline_link_clicks, objective, url_tags`;
  assert.deepEqual(
    { ...x },
    {
      messages: 0,
      checkouts: 0,
      inline_link_clicks: 0,
      objective: null,
      url_tags: null,
    },
  );
});

for (const col of ["messages", "checkouts", "inlineLinkClicks"] as const) {
  it(`negative ${col} is rejected`, async () => {
    await assert.rejects(upsertInsights([row({ [col]: -1 })]), /check/i);
  });
}
