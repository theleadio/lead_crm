// The weekly summary's SQL against a database: what counts as a signup and
// what as pending, one person in one class counted once, and a signup
// matched to the ad of its first Meta touch. Each test rolls back. Skipped
// when DATABASE_URL isn't set. Point it at a local or test database only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import { weeklySummary } from "../lib/reports/weekly.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// A range nothing in a seeded database falls inside.
const RANGE = adsReportQuerySchema.parse({
  from: "2031-03-03",
  to: "2031-03-16",
});
const ACCOUNT =
  process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "") || "test";
const uid = () => crypto.randomUUID().slice(0, 12);

async function viewer(role: Viewer["role"] = "marketing"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Weekly reader', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function person(): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Weekly person') RETURNING id`;
  return p.id;
}

async function newClass(track = "certification"): Promise<string> {
  const [co] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES (${uid()}, 'Weekly course', ${track}, 1, 900) RETURNING id`;
  const [cl] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, price_myr, status)
    VALUES (${co.id}, ${uid()}, current_date + 20, current_date + 20, 'en',
            'online', 'https://lead.test/c', 50, 900, 'open')
    RETURNING id`;
  return cl.id;
}

async function enrol(
  p: string,
  cls: string,
  status: string,
  at = "2031-03-10T02:00:00Z",
  holdUntil: string | null = null,
) {
  const [e] = await db()`
    INSERT INTO enrolment (person_id, class_id, status, created_at)
    VALUES (${p}, ${cls}, ${status}, ${at})
    RETURNING id`;
  // Set after the insert: the 006 trigger fills the hold on a reservation,
  // and a test of an expired hold needs one already in the past.
  if (holdUntil)
    await db()`
      UPDATE enrolment SET seat_reserved_until = ${holdUntil}
      WHERE id = ${e.id}`;
}

it("paid seats are signups; payment_pending and live holds are pending; expired holds are neither", async () => {
  const v = await viewer();
  const cls = await newClass();
  await enrol(await person(), cls, "confirmed");
  await enrol(await person(), cls, "attended");
  await enrol(await person(), cls, "payment_pending");
  await enrol(
    await person(),
    cls,
    "reserved",
    "2031-03-10T02:00:00Z",
    "2099-01-01T00:00:00Z",
  );
  await enrol(
    await person(),
    cls,
    "reserved",
    "2031-03-10T02:00:00Z",
    "2000-01-01T00:00:00Z",
  );

  const s = await weeklySummary(v, RANGE);
  const row = s.classes.find((c) => c.key === cls);
  assert.deepEqual(
    { signups: row?.signups, pending: row?.pending },
    { signups: 2, pending: 2 },
  );
});

it("a signup is credited to the ad of the person's first Meta touch", async () => {
  const v = await viewer();
  const cls = await newClass();
  const campaign = `9${String(Date.now()).padStart(14, "0")}`;
  const ad = `ad_${uid()}`;
  await db()`
    INSERT INTO meta_ad_insight
      (ad_id, day, account_id, campaign_id, campaign_name, adset_id,
       adset_name, ad_name, currency, spend, impressions, clicks)
    VALUES (${ad}, '2031-03-04', ${ACCOUNT}, ${campaign}, 'Weekly campaign',
            ${`set_${uid()}`}, 'Set', 'Weekly ad', 'MYR', 120, 100, 5)`;
  await db()`
    INSERT INTO class_meta_campaign (class_id, meta_campaign_id)
    VALUES (${cls}, ${campaign})`;

  const p = await person();
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_campaign_id,
                            utm_ad_id, is_first_touch)
    VALUES (${p}, 'lead_form', '2031-03-04T02:00:00Z', ${campaign}, ${ad}, true)`;
  await enrol(p, cls, "confirmed");

  const s = await weeklySummary(v, RANGE);
  const row = s.classes.find((c) => c.key === cls);
  assert.deepEqual(
    { meta: row?.meta, spend: row?.spend, topAd: row?.topAd },
    { meta: 1, spend: "120.00", topAd: "Weekly ad" },
  );
  const adRow = s.ads.find((a) => a.adId === ad);
  assert.deepEqual(adRow && [adRow.signups, adRow.spend], [1, "120.00"]);
});

it("a person with no recorded source counts as not matched", async () => {
  const v = await viewer();
  const cls = await newClass();
  await enrol(await person(), cls, "confirmed");
  const s = await weeklySummary(v, RANGE);
  assert.ok(s.match.none >= 1);
});

it("a click-to-WhatsApp opt-in that carries only an ad id gets Meta's campaign name", async () => {
  const v = await viewer();
  const cls = await newClass();
  const ad = `ad_${uid()}`;
  const campaign = `9${String(Date.now()).padStart(14, "0")}`;
  await db()`
    INSERT INTO meta_ad_insight
      (ad_id, day, account_id, campaign_id, campaign_name, adset_id,
       adset_name, ad_name, currency, spend, impressions, clicks)
    VALUES (${ad}, '2031-03-04', ${ACCOUNT}, ${campaign}, 'Named by Meta',
            ${`set_${uid()}`}, 'Set', 'Opt-in ad', 'MYR', 10, 100, 5)`;
  const p = await person();
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, ctwa_clid, utm_ad_id)
    VALUES (${p}, 'ctwa', '2031-03-05T02:00:00Z', ${`clid_${uid()}`}, ${ad})`;
  await enrol(p, cls, "confirmed");

  const s = await weeklySummary(v, RANGE);
  const row = s.people.find((x) => x.personId === p);
  assert.deepEqual(
    [row?.source, row?.utmCampaign],
    ["whatsapp_ad", "Named by Meta"],
  );
});

it("a signup's source is its last touch before signing up, bare import rows skipped", async () => {
  const v = await viewer();
  const cls = await newClass();
  const touch = (
    p: string,
    channel: string,
    at: string,
    campaign: string | null,
  ) =>
    db()`
      INSERT INTO touchpoint (person_id, channel, occurred_at, utm_source, utm_campaign)
      VALUES (${p}, ${channel}, ${at}, ${campaign ? "facebook" : null}, ${campaign})`;

  // Lead form, then a WhatsApp ad opt-in, then a bare import row, then the
  // seat on 10 Mar, then a later touch that can't have brought them.
  const optedIn = await person();
  await touch(optedIn, "lead_form", "2031-02-01T02:00:00Z", "Older form");
  await touch(optedIn, "ctwa", "2031-03-05T02:00:00Z", "Weekly opt-in");
  await touch(optedIn, "import", "2031-03-08T02:00:00Z", null);
  await touch(optedIn, "web_form", "2031-03-12T02:00:00Z", "After signup");
  await enrol(optedIn, cls, "confirmed");

  // Only a bare import row: no source.
  const imported = await person();
  await touch(imported, "import", "2031-03-04T02:00:00Z", null);
  await enrol(imported, cls, "confirmed");

  const s = await weeklySummary(v, RANGE);
  const who = (id: string) => s.people.find((p) => p.personId === id);
  assert.deepEqual(
    [who(optedIn)?.source, who(optedIn)?.utmCampaign, who(optedIn)?.name],
    ["whatsapp_ad", "Weekly opt-in", "Weekly person"],
  );
  assert.equal(who(imported)?.source, "none");
  assert.ok(
    s.campaigns.some(
      (c) => c.utmCampaign === "Weekly opt-in" && c.signups === 1,
    ),
  );
});

it("part_time is refused", async () => {
  const partTime = await viewer("part_time");
  await assert.rejects(() => weeklySummary(partTime, RANGE), PermissionError);
});
