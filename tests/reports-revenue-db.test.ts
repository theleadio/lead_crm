// §9.18 revenue per campaign against a database: SalesProcess payments and
// CRM `payment` rows, credited to the buyer's first Meta campaign. Each test
// rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { type Viewer } from "../lib/auth/permissions.ts";
import { revenuePerCampaign } from "../lib/reports/ads.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const RANGE = adsReportQuerySchema.parse({ from: "2031-03-01", to: "2031-03-31" });
const uid = () => crypto.randomUUID().slice(0, 12);

async function viewer(): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Report reader', 'marketing')
    RETURNING id`;
  return { id: u.id, role: "marketing" };
}

async function newClass(): Promise<string> {
  const [co] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES (${uid()}, 'Revenue course', 'workshop', 1, 680) RETURNING id`;
  const [cl] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, price_myr, status)
    VALUES (${co.id}, ${uid()}, current_date + 20, current_date + 20, 'en',
            'online', 'https://lead.test/c', 50, 680, 'open')
    RETURNING id`;
  return cl.id;
}

// A person whose first touch is a Meta lead form on `campaignId`, 10 Mar 2031.
async function lead(campaignId: string): Promise<string> {
  const [p] = await db()`INSERT INTO person (full_name) VALUES ('Buyer') RETURNING id`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_campaign_id, is_first_touch)
    VALUES (${p.id}, 'lead_form', '2031-03-10T04:00:00Z', ${campaignId}, true)`;
  return p.id;
}

async function seat(person: string, classId: string): Promise<string> {
  const [e] = await db()`
    INSERT INTO enrolment (person_id, class_id, status)
    VALUES (${person}, ${classId}, 'confirmed') RETURNING id`;
  return e.id;
}

async function crmPayment(f: {
  enrolment?: string;
  deal?: string;
  status?: string;
  amount: number;
  refunded?: number;
  paidAt?: string;
}) {
  await db()`
    INSERT INTO payment (enrolment_id, deal_id, method, status, amount_myr,
                         refunded_amount_myr, paid_at, refunded_at)
    VALUES (${f.enrolment ?? null}, ${f.deal ?? null}, 'stripe_card',
            ${f.status ?? "succeeded"}, ${f.amount}, ${f.refunded ?? 0},
            ${f.paidAt ?? "2031-03-15T04:00:00Z"},
            ${f.refunded ? "2031-03-20T04:00:00Z" : null})`;
}

const revenueOf = async (v: Viewer, campaignId: string) =>
  (await revenuePerCampaign(v, RANGE)).find((r) => r.campaignId === campaignId);

it("revenue: CRM payments add to SalesProcess payments on the same campaign", async () => {
  const v = await viewer();
  const campaign = `c-${uid()}`;
  const classId = await newClass();

  const crmBuyer = await lead(campaign);
  await crmPayment({ enrolment: await seat(crmBuyer, classId), amount: 680 });

  const spBuyer = await lead(campaign);
  const contact = uid();
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, external_ref)
    VALUES (${spBuyer}, 'import', '2031-03-09T04:00:00Z', ${`ghl:${contact}`})`;
  await db()`
    INSERT INTO salesprocess_payment (id, order_id, ghl_contact_id, status, amount_myr,
                                      currency, live_mode, paid_at)
    VALUES (${uid()}, ${uid()}, ${contact}, 'succeeded', 3200, 'MYR', true,
            '2031-03-16T04:00:00Z')`;

  assert.deepEqual(await revenueOf(v, campaign), {
    campaignId: campaign,
    revenue: "3880.00",
    orders: 2,
  });
});

it("revenue: CRM payments net of refunds, instalments one order, a deal-only payment counts", async () => {
  const v = await viewer();
  const campaign = `c-${uid()}`;
  const classId = await newClass();

  const buyer = await lead(campaign);
  const enrolment = await seat(buyer, classId);
  await crmPayment({ enrolment, amount: 300 });
  await crmPayment({ enrolment, amount: 380, refunded: 80, status: "partially_refunded" });

  const dealBuyer = await lead(campaign);
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, won_at)
    VALUES ('individual', 'won', ${dealBuyer}, now()) RETURNING id`;
  await crmPayment({ deal: d.id, amount: 500 });

  // 300 + (380 - 80) + 500; two orders: the enrolment and the deal.
  assert.deepEqual(await revenueOf(v, campaign), {
    campaignId: campaign,
    revenue: "1100.00",
    orders: 2,
  });
});

it("revenue: refunded, pending, out-of-range and paid-before-first-touch CRM payments do not count", async () => {
  const v = await viewer();
  const campaign = `c-${uid()}`;
  const classId = await newClass();
  const buyer = await lead(campaign);
  const enrolment = await seat(buyer, classId);

  await crmPayment({ enrolment, amount: 680, refunded: 680, status: "refunded" });
  await crmPayment({ enrolment, amount: 680, status: "pending", paidAt: "2031-03-15T04:00:00Z" });
  await crmPayment({ enrolment, amount: 680, paidAt: "2031-04-02T04:00:00Z" });
  // Inside the range but before the 10 Mar first touch: the ad did not sell it.
  await crmPayment({ enrolment, amount: 680, paidAt: "2031-03-05T04:00:00Z" });

  assert.equal(await revenueOf(v, campaign), undefined);
});

it("revenue: an unmatched CRM payment (no enrolment, no deal) is not credited", async () => {
  const v = await viewer();
  const campaign = `c-${uid()}`;
  const classId = await newClass();
  await crmPayment({ enrolment: await seat(await lead(campaign), classId), amount: 680 });
  await db()`
    INSERT INTO payment (match_status, method, status, amount_myr, paid_at)
    VALUES ('unmatched', 'stripe_card', 'succeeded', 1000, '2031-03-15T04:00:00Z')`;

  assert.deepEqual(await revenueOf(v, campaign), {
    campaignId: campaign,
    revenue: "680.00",
    orders: 1,
  });
});
