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

const RANGE = adsReportQuerySchema.parse({ from: "2031-03-01", to: "2031-03-31" });
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

const wa = () => `6011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const click = (adId: string, clid: string) => ({
  adId,
  ctwaClid: clid,
  headline: null,
  url: null,
});
const day = (d: number) => new Date(Date.UTC(2031, 2, d, 2));

it("counts each person's first ad click once, with spend per ad", async () => {
  const v = await reader();
  await insight(AD_A, "100.00", 9);
  await insight(AD_B, "40.00", 3);
  await insight(AD_IDLE, "25.00", 2);

  const p1 = wa();
  const p2 = wa();
  await saveCtwaTouch(p1, "One", click(AD_A, "c1"), day(5));
  await saveCtwaTouch(p2, "Two", click(AD_A, "c2"), day(6));
  // p1 clicks another ad later: not a second opt-in, counted as "again" on B.
  await saveCtwaTouch(p1, "One", click(AD_B, "c3"), day(7));

  const t = await whatsappOptinRows(v, RANGE);
  const by = new Map(t.rows.map((r) => [r.adId, r]));
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
  assert.equal(by.get(AD_B)?.optins, 0);
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
  const row = (await whatsappOptinRows(v, RANGE)).rows.find((r) => r.adId === AD_A);
  assert.equal(row?.optins, 2);
  assert.equal(row?.fresh, 1);
});

it("an opt-in before the range is not counted again inside it", async () => {
  const v = await reader();
  const n = wa();
  await saveCtwaTouch(n, "Early", click(AD_A, "e1"), new Date(Date.UTC(2031, 1, 20)));
  await saveCtwaTouch(n, "Early", click(AD_A, "e2"), day(10));
  const row = (await whatsappOptinRows(v, RANGE)).rows.find((r) => r.adId === AD_A);
  assert.equal(row?.optins, 0);
  assert.equal(row?.again, 1);
});
