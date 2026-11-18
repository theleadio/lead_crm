// The weekly summary's arithmetic, without a database: which week a signup
// falls in (Kuala Lumpur, Monday start), the same-point comparison, and how
// classes and ads add up. The SQL side is in reports-weekly-db.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mondayOf,
  previousWindow,
  sourceBucket,
  summarise,
  weekQuery,
  type SignupRow,
  type WeeklyInput,
} from "../lib/reports/weekly.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

// Monday 2 Nov 2026 to Wednesday 18 Nov: two full weeks and three days.
const Q = adsReportQuerySchema.parse({ from: "2026-11-02", to: "2026-11-18" });

const signup = (at: string, over: Partial<SignupRow> = {}): SignupRow => ({
  personId: crypto.randomUUID(),
  classId: "c1",
  courseId: "k1",
  at,
  hrdc: false,
  source: "seat",
  campaignId: null,
  adId: null,
  matched: "none",
  firstTouchAt: null,
  ...over,
});

const input = (over: Partial<WeeklyInput> = {}): WeeklyInput => ({
  signups: [],
  pending: [],
  spend: [],
  classes: [{ key: "c1", name: "N8N · 25 Nov 2026", workshop: false }],
  campaignClass: [],
  adNames: [],
  ...over,
});

test("mondayOf: a Sunday belongs to the week that started the Monday before", () => {
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
});

test("a signup late on Sunday night in Kuala Lumpur counts in that week, not UTC's", () => {
  // 23:30 Sunday 15 Nov in KL is 15:30 UTC the same day; 00:30 Monday 16 Nov
  // KL is still Sunday in UTC.
  const s = summarise(
    input({
      signups: [signup("2026-11-15T15:30:00Z"), signup("2026-11-15T16:30:00Z")],
    }),
    Q,
  );
  const week = (start: string) => s.weeks.find((w) => w.weekStart === start);
  assert.equal(week("2026-11-09")?.signups, 1);
  assert.equal(week("2026-11-16")?.signups, 1);
});

test("weeks: every Monday in range, empty ones as zero, the partial week says so", () => {
  const s = summarise(input(), Q);
  assert.deepEqual(
    s.weeks.map((w) => [w.weekStart, w.days, w.signups]),
    [
      ["2026-11-02", 7, 0],
      ["2026-11-09", 7, 0],
      ["2026-11-16", 3, 0],
    ],
  );
  assert.equal(s.latest.weekStart, "2026-11-16");
});

test("latest week is compared with the same days of the week before", () => {
  const s = summarise(
    input({
      signups: [
        signup("2026-11-17T03:00:00Z"), // this week, Tuesday
        signup("2026-11-10T03:00:00Z"), // last week, Tuesday: compared
        signup("2026-11-13T03:00:00Z"), // last week, Friday: not yet
      ],
      pending: [{ classId: "c1", courseId: "k1", at: "2026-11-09T03:00:00Z" }],
    }),
    Q,
  );
  assert.equal(s.latest.signups, 1);
  assert.deepEqual(s.previous, { signups: 1, pending: 1, spend: "0.00" });
});

test("previousWindow: a partial week compares the same days, a full week the full week before", () => {
  assert.deepEqual(previousWindow(Q), { from: "2026-11-09", to: "2026-11-11" });
  assert.deepEqual(previousWindow({ from: "2026-11-09", to: "2026-11-15" }), {
    from: "2026-11-02",
    to: "2026-11-08",
  });
  // A range starting mid-week compares from its own first day.
  assert.deepEqual(previousWindow({ from: "2026-11-11", to: "2026-11-15" }), {
    from: "2026-11-04",
    to: "2026-11-08",
  });
});

test("previous spend is summed, and a second currency there is refused too", () => {
  const prev = (currency: string, spend: string) => ({ currency, spend });
  const s = summarise(
    input({ previousSpend: [prev("MYR", "10.50"), prev("MYR", "0.25")] }),
    Q,
  );
  assert.equal(s.previous.spend, "10.75");
  assert.throws(() =>
    summarise(input({ previousSpend: [prev("USD", "1")] }), Q),
  );
});

test("weekQuery: no param is the last full week; any day snaps to its Monday", () => {
  // Thursday 19 Nov 2026.
  assert.deepEqual(weekQuery(undefined, "2026-11-19"), {
    from: "2026-11-09",
    to: "2026-11-15",
    current: false,
  });
  assert.deepEqual(weekQuery("2026-11-04", "2026-11-19"), {
    from: "2026-11-02",
    to: "2026-11-08",
    current: false,
  });
  // The current week ends today, not on Sunday.
  assert.deepEqual(weekQuery("2026-11-16", "2026-11-19"), {
    from: "2026-11-16",
    to: "2026-11-19",
    current: true,
  });
  // A future week and a malformed one are refused, not swapped.
  assert.equal(weekQuery("2026-11-23", "2026-11-19"), null);
  assert.equal(weekQuery("2026-02-30", "2026-11-19"), null);
  assert.equal(weekQuery("next", "2026-11-19"), null);
});

test("sourceBucket: opt-ins, forms and tagged links are told apart", () => {
  const t = (channel: string, utmSource: string | null = null) => ({
    channel,
    utmSource,
    utmCampaign: null,
  });
  assert.equal(sourceBucket(null), "none");
  assert.equal(sourceBucket(t("ctwa")), "whatsapp_ad");
  assert.equal(sourceBucket(t("whatsapp")), "whatsapp");
  assert.equal(sourceBucket(t("lead_form")), "lead_form");
  assert.equal(sourceBucket(t("web_form", "facebook")), "web_form");
  assert.equal(sourceBucket(t("import", "facebook")), "utm_link");
  assert.equal(sourceBucket(t("payment_link", "google")), "utm_link");
  assert.equal(sourceBucket(t("import", "self:referral")), "self");
});

test("signups by source, by UTM campaign, and the list of people", () => {
  const touch = (channel: string, utmCampaign: string | null) => ({
    channel,
    utmSource: utmCampaign ? "facebook" : null,
    utmCampaign,
  });
  const s = summarise(
    input({
      signups: [
        signup("2026-11-03T03:00:00Z", {
          personName: "Ali",
          lastTouch: touch("ctwa", "Full-Stack 14 Nov"),
        }),
        signup("2026-11-10T03:00:00Z", {
          personName: "Bee",
          lastTouch: touch("lead_form", "Full-Stack 14 Nov"),
        }),
        signup("2026-11-12T03:00:00Z", {
          personName: "Chan",
          lastTouch: touch("web_form", "Automation 11 Nov"),
        }),
        signup("2026-11-12T03:00:00Z", { personName: "Dev" }),
        // Before the range: in no count and not listed.
        signup("2026-10-28T03:00:00Z", { personName: "Old" }),
      ],
    }),
    Q,
  );
  assert.equal(s.bySource.whatsapp_ad, 1);
  assert.equal(s.bySource.lead_form, 1);
  assert.equal(s.bySource.web_form, 1);
  assert.equal(s.bySource.none, 1);
  assert.equal(
    Object.values(s.bySource).reduce((a, b) => a + b, 0),
    s.totals.signups,
  );
  assert.deepEqual(
    s.campaigns.map((c) => [c.utmCampaign, c.signups]),
    [
      ["Full-Stack 14 Nov", 2],
      ["Automation 11 Nov", 1],
    ],
  );
  assert.equal(s.campaignsDropped, 0);
  // Newest first, then by name; the class name rides along.
  assert.deepEqual(
    s.people.map((p) => [p.name, p.day, p.source]),
    [
      ["Chan", "2026-11-12", "web_form"],
      ["Dev", "2026-11-12", "none"],
      ["Bee", "2026-11-10", "lead_form"],
      ["Ali", "2026-11-03", "whatsapp_ad"],
    ],
  );
  assert.equal(s.people[0].className, "N8N · 25 Nov 2026");
});

test("rows before the range feed the comparison but no total", () => {
  const s = summarise(input({ signups: [signup("2026-10-28T03:00:00Z")] }), Q);
  assert.equal(s.totals.signups, 0);
  assert.equal(s.classes.length, 0);
});

test("classes: signups, HRDC, Meta and pending per class; spend through the campaign link", () => {
  const s = summarise(
    input({
      signups: [
        signup("2026-11-03T03:00:00Z", {
          hrdc: true,
          matched: "meta",
          campaignId: "111",
          adId: "a1",
        }),
        signup("2026-11-04T03:00:00Z", {
          matched: "meta",
          campaignId: "111",
          adId: "a1",
        }),
        signup("2026-11-05T03:00:00Z", { adId: "a2", matched: "meta" }),
        signup("2026-11-05T03:00:00Z", {
          classId: null,
          courseId: "k2",
          source: "order",
        }),
      ],
      pending: [{ classId: "c1", courseId: "k1", at: "2026-11-06T03:00:00Z" }],
      spend: [
        {
          weekStart: "2026-11-02",
          campaignId: "111",
          adId: "a1",
          currency: "MYR",
          spend: "100.10",
        },
        {
          weekStart: "2026-11-09",
          campaignId: "111",
          adId: "a1",
          currency: "MYR",
          spend: "0.20",
        },
        {
          weekStart: "2026-11-09",
          campaignId: "999",
          adId: "a9",
          currency: "MYR",
          spend: "50.00",
        },
      ],
      campaignClass: [["111", "c1"]],
      adNames: [
        ["a1", "N8N video A"],
        ["a2", "N8N video A"],
      ],
      adCampaignNames: [
        ["a1", "LEAD | Nov2026 | Sales | N8N 25 Nov"],
        ["a2", "LEAD | Nov2026 | Sales | N8N retarget"],
      ],
    }),
    Q,
  );
  const c1 = s.classes.find((c) => c.key === "c1")!;
  assert.deepEqual(
    { ...c1 },
    {
      key: "c1",
      name: "N8N · 25 Nov 2026",
      workshop: false,
      signups: 3,
      hrdc: 1,
      meta: 3,
      pending: 1,
      spend: "100.30",
      topAd: "N8N video A",
    },
  );
  // The order with no class is its own course-level row.
  assert.equal(s.classes.find((c) => c.key === "course:k2")?.signups, 1);
  assert.equal(s.unlinkedSpend, "50.00");
  assert.equal(s.totals.spend, "150.30");
  assert.deepEqual(s.sources, { seat: 3, order: 1, sheet: 0 });
  assert.deepEqual(s.match, {
    meta: 3,
    meta_no_id: 0,
    self: 0,
    other: 0,
    none: 1,
  });

  // The ad that spent and brought nobody is listed, at zero.
  const a9 = s.ads.find((a) => a.adId === "a9");
  assert.deepEqual(a9 && { signups: a9.signups, spend: a9.spend }, {
    signups: 0,
    spend: "50.00",
  });
  assert.equal(s.ads[0].adName, "N8N video A");
  assert.equal(s.ads[0].className, "N8N · 25 Nov 2026");
  // Same-named ads are told apart by campaign; an ad with signups and no
  // spend in range says it spent earlier, one that spent does not.
  const a2 = s.ads.find((a) => a.adId === "a2")!;
  assert.equal(a2.campaignName, "LEAD | Nov2026 | Sales | N8N retarget");
  assert.equal(a2.spentEarlier, true);
  assert.equal(s.ads[0].spentEarlier, false);
  assert.equal(a9?.spentEarlier, false);
  assert.equal(a9?.campaignName, null);
});

test("spend in two currencies is refused, not added", () => {
  assert.throws(() =>
    summarise(
      input({
        spend: [
          {
            weekStart: "2026-11-02",
            campaignId: "1",
            adId: "a",
            currency: "MYR",
            spend: "1",
          },
          {
            weekStart: "2026-11-02",
            campaignId: "1",
            adId: "b",
            currency: "USD",
            spend: "1",
          },
        ],
      }),
      Q,
    ),
  );
});

test("by first touch: a Meta signup counts in the week of its first ad touch", () => {
  const meta = (at: string, firstTouchAt: string | null) =>
    signup(at, { matched: "meta", firstTouchAt });
  const s = summarise(
    input({
      signups: [
        meta("2026-11-17T03:00:00Z", "2026-11-04T03:00:00Z"), // touched wk 2 Nov
        meta("2026-11-10T03:00:00Z", "2026-11-04T03:00:00Z"), // touched wk 2 Nov
        meta("2026-11-17T03:00:00Z", "2026-11-16T03:00:00Z"), // touched wk 16 Nov
        meta("2026-11-12T03:00:00Z", "2026-10-20T03:00:00Z"), // before the range
        // Sunday night KL is still the earlier week.
        meta("2026-11-17T03:00:00Z", "2026-11-15T15:30:00Z"),
        signup("2026-11-12T03:00:00Z"), // not from Meta: never counted
      ],
      spend: [
        {
          weekStart: "2026-11-02",
          campaignId: "1",
          adId: "a",
          currency: "MYR",
          spend: "300.00",
        },
      ],
    }),
    Q,
  );
  assert.deepEqual(
    s.cohorts.map((c) => [c.weekStart, c.spend, c.metaSignups]),
    [
      ["2026-11-02", "300.00", 2],
      ["2026-11-09", "0.00", 1],
      ["2026-11-16", "0.00", 1],
    ],
  );
  assert.equal(s.cohortBefore, 1);
});

test("sheet signups count by class and source, and an approximate week says so", () => {
  const s = summarise(
    input({
      signups: [
        signup("2026-11-03T03:00:00Z", {
          source: "sheet",
          approx: true,
          matched: "self",
        }),
        signup("2026-11-04T03:00:00Z", {
          source: "sheet",
          approx: true,
          matched: "none",
        }),
        signup("2026-11-17T03:00:00Z", { source: "sheet", matched: "none" }),
        signup("2026-11-17T04:00:00Z"),
      ],
      sheetUnmapped: [{ label: "Mystery Class 12 Nov", people: 2 }],
      sheetLastSeen: "2026-11-18T01:00:00Z",
    }),
    Q,
  );
  assert.deepEqual(s.sources, { seat: 1, order: 0, sheet: 3 });
  assert.equal(s.match.self, 1);
  // Only the week holding backfilled rows is approximate.
  assert.deepEqual(
    s.weeks.map((w) => w.approx),
    [true, false, false],
  );
  assert.equal(s.classes.find((c) => c.key === "c1")?.signups, 4);
  assert.deepEqual(s.sheetUnmapped, [
    { label: "Mystery Class 12 Nov", people: 2 },
  ]);
  assert.equal(s.sheetLastSeen, "2026-11-18T01:00:00.000Z");
});
