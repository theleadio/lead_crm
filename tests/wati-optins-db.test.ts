// whatsappOptinRows: opt-ins per click-to-WhatsApp ad. Each test rolls back.
// Dates sit in 2031 so nothing seeded falls in range.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { saveCtwaTouch } from "../lib/import/wati-ctwa.ts";
import { whatsappOptinRows } from "../lib/reports/ads.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const RANGE = adsReportQuerySchema.parse({
  from: "2031-03-01",
  to: "2031-03-31",
});
const AD_A = "990000000000001";
const AD_B = "990000000000002";
const AD_IDLE = "990000000000003";
const CAMPAIGN = "990000000000100";

async function reader(): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Report reader', 'super_admin')
    RETURNING id`;
  return { id: u.id, role: "super_admin" };
}

async function insight(adId: string, spend: string, messages: number) {
  await db()`
    INSERT INTO meta_ad_insight (ad_id, day, account_id, campaign_id, campaign_name,
                                 adset_id, adset_name, ad_name, currency, spend,
                                 impressions, clicks, messages)
    VALUES (${adId}, '2031-03-05', 'act_test', ${CAMPAIGN},
            'LEAD | Mar2031 | WhatsApp | Test', 'set1', 'Set 1',
            ${`Ad ${adId.slice(-1)}`}, 'MYR', ${spend}, 1000, 50, ${messages})`;
}

const wa = () =>
  `6011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const click = (adId: string, clid: string) => ({
  adId,
  ctwaClid: clid,
  headline: null,
  url: null,
});
const day = (d: number) => new Date(Date.UTC(2031, 2, d, 2));

it("counts each person once per ad, with spend per ad", async () => {
  const v = await reader();
  await insight(AD_A, "100.00", 9);
  await insight(AD_B, "40.00", 3);
  await insight(AD_IDLE, "25.00", 2);

  const p1 = wa();
  const p2 = wa();
  await saveCtwaTouch(p1, "One", click(AD_A, "c1"), day(5));
  await saveCtwaTouch(p2, "Two", click(AD_A, "c2"), day(6));
  // p1 clicks another ad later: an opt-in on B too, as "again".
  await saveCtwaTouch(p1, "One", click(AD_B, "c3"), day(7));

  const t = await whatsappOptinRows(v, RANGE);
  const by = new Map(t.rows.map((r) => [r.adId, r]));
  // Two people, though p1 is on both ads.
  assert.equal(t.total, 2);
  assert.deepEqual(
    { ...by.get(AD_A) },
    {
      campaignId: CAMPAIGN,
      campaign: "LEAD | Mar2031 | WhatsApp | Test",
      adId: AD_A,
      adName: "Ad 1",
      optins: 2,
      fresh: 2,
      again: 0,
      spendMyr: "100.00",
      metaMessages: 9,
    },
  );
  assert.equal(by.get(AD_B)?.optins, 1);
  assert.equal(by.get(AD_B)?.fresh, 0);
  assert.equal(by.get(AD_B)?.again, 1);
  // Spent on conversations, brought nobody: still listed, at zero.
  assert.equal(by.get(AD_IDLE)?.optins, 0);
  assert.equal(by.get(AD_IDLE)?.spendMyr, "25.00");
});

it("an opt-in from someone already in contact is not fresh", async () => {
  const v = await reader();
  const n = wa();
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164)
    VALUES ('Known', ${`+${n}`}, ${`+${n}`}) RETURNING id`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_source)
    VALUES (${p.id}, 'web_form', ${day(1)}, 'google')`;
  // A SalesProcess import row is plumbing, not contact: it doesn't count.
  const m = wa();
  const [q] = await db()`
    INSERT INTO person (full_name, phone, phone_e164)
    VALUES ('Imported', ${`+${m}`}, ${`+${m}`}) RETURNING id`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, external_ref)
    VALUES (${q.id}, 'import', ${day(1)}, ${`ghl:${crypto.randomUUID()}`})`;

  await saveCtwaTouch(n, "Known", click(AD_A, "k1"), day(8));
  await saveCtwaTouch(m, "Imported", click(AD_A, "k2"), day(8));
  const row = (await whatsappOptinRows(v, RANGE)).rows.find(
    (r) => r.adId === AD_A,
  );
  assert.equal(row?.optins, 2);
  assert.equal(row?.fresh, 1);
  assert.equal(row?.again, 1);
});

it("an opt-in before the range is not counted again inside it", async () => {
  const v = await reader();
  const n = wa();
  await saveCtwaTouch(
    n,
    "Early",
    click(AD_A, "e1"),
    new Date(Date.UTC(2031, 1, 20)),
  );
  await saveCtwaTouch(n, "Early", click(AD_A, "e2"), day(10));
  const row = (await whatsappOptinRows(v, RANGE)).rows.find(
    (r) => r.adId === AD_A,
  );
  assert.equal(row?.optins, 1);
  assert.equal(row?.fresh, 0);
  assert.equal(row?.again, 1);
});

it("opting in and coming back through the same ad is one opt-in", async () => {
  const v = await reader();
  const n = wa();
  await saveCtwaTouch(n, "Twice", click(AD_A, "t1"), day(3));
  await saveCtwaTouch(n, "Twice", click(AD_A, "t2"), day(9));
  const row = (await whatsappOptinRows(v, RANGE)).rows.find(
    (r) => r.adId === AD_A,
  );
  assert.equal(row?.optins, 1);
  assert.equal(row?.fresh, 1);
  assert.equal(row?.again, 0);
});

it("new and again are counted per ad: first-timers new, a returner again", async () => {
  const v = await reader();
  for (const [ad, d] of [
    [AD_A, 2],
    [AD_A, 4],
    [AD_B, 6],
    [AD_A, 8],
    [AD_B, 9],
  ] as const)
    await saveCtwaTouch(wa(), "P", click(ad, `s${ad}${d}`), day(d));
  const p = wa();
  await saveCtwaTouch(p, "P", click(AD_A, "x1"), day(11));
  await saveCtwaTouch(p, "P", click(AD_B, "x2"), day(12));
  await saveCtwaTouch(p, "P", click(AD_B, "x3"), day(13));
  const t = await whatsappOptinRows(v, RANGE);
  const by = new Map(t.rows.map((r) => [r.adId, r]));
  const counts = (ad: string) => {
    const r = by.get(ad);
    return { optins: r?.optins, fresh: r?.fresh, again: r?.again };
  };
  // A: three first-timers, plus p's first ever message.
  assert.deepEqual(counts(AD_A), { optins: 4, fresh: 4, again: 0 });
  // B: two first-timers, plus p coming back twice, counted once as again.
  assert.deepEqual(counts(AD_B), { optins: 3, fresh: 2, again: 1 });
  // Six people: five first-timers and p, once though p is on both ads.
  assert.equal(t.total, 6);
});

it("an ad whose touches carry two campaign ids is one row, on Meta's campaign", async () => {
  const v = await reader();
  await insight(AD_A, "100.00", 9);
  await saveCtwaTouch(wa(), "Mapped", click(AD_A, "m1"), day(4));
  // A touch that names another campaign itself, as an older import might.
  // Its id sorts below the real one, so the touchpoint's id would win any
  // min() and the test only passes when Meta's campaign is preferred.
  const n = wa();
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164)
    VALUES ('Tagged', ${`+${n}`}, ${`+${n}`}) RETURNING id`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_ad_id,
                            utm_campaign_id, ctwa_clid)
    VALUES (${p.id}, 'ctwa', ${day(5)}, ${AD_A}, '990000000000050', 'm2')`;

  const rows = (await whatsappOptinRows(v, RANGE)).rows.filter(
    (r) => r.adId === AD_A,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].optins, 2);
  assert.equal(rows[0].campaignId, CAMPAIGN);
  assert.equal(rows[0].spendMyr, "100.00");
});

it("an ad with no spend in range still takes Meta's campaign, not the touch's", async () => {
  const v = await reader();
  // Spend only before the range: the in-range spend has nothing for this ad.
  await db()`
    INSERT INTO meta_ad_insight (ad_id, day, account_id, campaign_id, campaign_name,
                                 adset_id, adset_name, ad_name, currency, spend,
                                 impressions, clicks, messages)
    VALUES (${AD_B}, '2031-02-10', 'act_test', ${CAMPAIGN},
            'LEAD | Feb2031 | WhatsApp | Test', 'set1', 'Set 1', 'Ad 2', 'MYR',
            '10.00', 100, 5, 1)`;
  const n = wa();
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164)
    VALUES ('Tagged', ${`+${n}`}, ${`+${n}`}) RETURNING id`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_ad_id,
                            utm_campaign_id, ctwa_clid)
    VALUES (${p.id}, 'ctwa', ${day(5)}, ${AD_B}, '990000000000050', 'n1')`;
  const row = (await whatsappOptinRows(v, RANGE)).rows.find(
    (r) => r.adId === AD_B,
  );
  assert.equal(row?.campaignId, CAMPAIGN);
  assert.equal(row?.spendMyr, null);
});
