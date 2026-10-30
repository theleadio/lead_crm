// Integration tests for the §9.18 ads report against the seeded dev
// database. Each test rolls back. Skipped when DATABASE_URL isn't set.
//
// The Meta predicate, the grouping, the range boundaries and the row cap all
// live in SQL, so this is where they are proved — against real touchpoints
// rather than a TypeScript re-implementation that could drift from the
// definition that counts.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import {
  campaignRows,
  earliestMetaTouchpoint,
  leadsPerWeek,
  signupsPerCampaign,
  sourceRows,
} from "../lib/reports/ads.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// A range nothing else in the seeded database falls inside, so every count a
// test asserts is only what that test inserted.
const RANGE = adsReportQuerySchema.parse({
  from: "2031-03-01",
  to: "2031-03-31",
});

async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Report reader', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newPerson(): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Report person') RETURNING id`;
  return p.id;
}

type TouchFields = {
  person: string;
  channel?: string;
  campaign?: string | null;
  source?: string | null;
  fbclid?: string | null;
  ctwaClid?: string | null;
  gclid?: string | null;
  firstTouch?: boolean;
  at?: string;
};

async function newTouchpoint(f: TouchFields): Promise<void> {
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, utm_campaign,
                            utm_source, fbclid, ctwa_clid, gclid,
                            is_first_touch)
    VALUES (${f.person}, ${f.channel ?? "web_form"},
            ${f.at ?? "2031-03-10T04:00:00Z"}, ${f.campaign ?? null},
            ${f.source ?? null}, ${f.fbclid ?? null}, ${f.ctwaClid ?? null},
            ${f.gclid ?? null}, ${f.firstTouch ?? false})`;
}

const campaignOf = (
  table: Awaited<ReturnType<typeof campaignRows>>,
  name: string | null,
) => table.rows.find((r) => r.campaign === name);

// §6: the screen is not the security boundary. A caller that skips it is
// refused here, and a part-timer's assigned-only read does not open an
// aggregate over everyone's leads (O62).
it("part_time cannot read the report at all", async () => {
  const partTime = await newUser("part_time");
  await assert.rejects(() => campaignRows(partTime, RANGE), PermissionError);
  await assert.rejects(() => sourceRows(partTime, RANGE), PermissionError);
  await assert.rejects(() => earliestMetaTouchpoint(partTime), PermissionError);
});

it("marketing, operations and management all read the report", async () => {
  for (const role of ["marketing", "operations", "management"] as const) {
    const viewer = await newUser(role);
    const table = await campaignRows(viewer, RANGE);
    assert.ok(Array.isArray(table.rows), role);
  }
});

// O63's definition, proved on rows rather than asserted on a constant.
it("counts Lead Ads, click-to-WhatsApp, fbclid, ctwa_clid and tagged sources", async () => {
  const viewer = await newUser("marketing");
  const leadForm = await newPerson();
  const ctwa = await newPerson();
  const clicked = await newPerson();
  const whatsapp = await newPerson();
  const tagged = await newPerson();
  const google = await newPerson();

  await newTouchpoint({ person: leadForm, channel: "lead_form" });
  await newTouchpoint({ person: ctwa, channel: "ctwa" });
  await newTouchpoint({ person: clicked, fbclid: "fb.1.abc" });
  await newTouchpoint({
    person: whatsapp,
    channel: "whatsapp",
    ctwaClid: "ctwa.1",
  });
  await newTouchpoint({ person: tagged, source: "Facebook" });
  // Not Meta: a Google click with its own id and no Meta marker.
  await newTouchpoint({
    person: google,
    source: "google",
    gclid: "gcl.1",
    campaign: "search_brand",
  });

  const table = await campaignRows(viewer, RANGE);
  assert.equal(table.total, 5, "five Meta touchpoints, the Google one is out");
  assert.equal(campaignOf(table, "search_brand"), undefined);
});

it("a tagged source matches whatever its casing and padding", async () => {
  const viewer = await newUser("marketing");
  for (const source of ["Facebook", " facebook ", "INSTAGRAM", "Ig"]) {
    const person = await newPerson();
    await newTouchpoint({ person, source, campaign: "casing" });
  }
  const table = await campaignRows(viewer, RANGE);
  assert.equal(campaignOf(table, "casing")?.leads, 4);
});

it("a person's first and later touch are counted and split", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  await newTouchpoint({
    person,
    channel: "lead_form",
    campaign: "spring_leads",
    firstTouch: true,
    at: "2031-03-05T04:00:00Z",
  });
  await newTouchpoint({
    person,
    channel: "lead_form",
    campaign: "spring_leads",
    at: "2031-03-20T04:00:00Z",
  });

  const row = campaignOf(await campaignRows(viewer, RANGE), "spring_leads");
  assert.deepEqual(
    {
      leads: row?.leads,
      first: row?.firstTouch,
      later: row?.laterTouch,
      people: row?.people,
    },
    { leads: 2, first: 1, later: 1, people: 1 },
  );
});

it("leads with no campaign are one row, and the rows sum to the total", async () => {
  const viewer = await newUser("marketing");
  const named = await newPerson();
  const bare = await newPerson();
  await newTouchpoint({ person: named, channel: "ctwa", campaign: "named" });
  await newTouchpoint({ person: bare, channel: "ctwa" });

  const table = await campaignRows(viewer, RANGE);
  assert.equal(campaignOf(table, null)?.leads, 1, "the no-campaign row");
  assert.equal(
    table.rows.reduce((sum, r) => sum + r.leads, 0),
    table.total,
  );
});

it("the biggest campaign comes first", async () => {
  const viewer = await newUser("marketing");
  for (let i = 0; i < 3; i++) {
    const person = await newPerson();
    await newTouchpoint({ person, channel: "ctwa", campaign: "big" });
  }
  const person = await newPerson();
  await newTouchpoint({ person, channel: "ctwa", campaign: "small" });

  const table = await campaignRows(viewer, RANGE);
  const order = table.rows.map((r) => r.campaign);
  assert.ok(
    order.indexOf("big") < order.indexOf("small"),
    `big before small, got ${order.join(", ")}`,
  );
});

it("the source table splits a source by channel", async () => {
  const viewer = await newUser("marketing");
  for (const channel of ["lead_form", "lead_form", "ctwa"]) {
    const person = await newPerson();
    await newTouchpoint({ person, channel, source: "facebook" });
  }

  const row = (await sourceRows(viewer, RANGE)).rows.find(
    (r) => r.source === "facebook",
  );
  assert.equal(row?.leads, 3);
  assert.deepEqual(
    [...(row?.byChannel ?? [])].sort((a, b) =>
      a.channel.localeCompare(b.channel),
    ),
    [
      { channel: "ctwa", leads: 1 },
      { channel: "lead_form", leads: 2 },
    ],
  );
});

it("a source that is only an fbclid is its own row, not dropped", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  await newTouchpoint({ person, fbclid: "fb.1.xyz" });

  const table = await sourceRows(viewer, RANGE);
  assert.equal(table.total, 1);
  assert.equal(table.rows.find((r) => r.source === null)?.leads, 1);
});

// §4: whole Kuala Lumpur days, both ends inclusive, and nothing from the day
// after. 2031-03-01T00:15 and 2031-03-31T23:50 in Kuala Lumpur are
// 2031-02-28T16:15Z and 2031-03-31T15:50Z.
it("both boundary days are inside the range and the next day is not", async () => {
  const viewer = await newUser("marketing");
  const first = await newPerson();
  const last = await newPerson();
  const after = await newPerson();
  await newTouchpoint({
    person: first,
    channel: "ctwa",
    campaign: "edges",
    at: "2031-02-28T16:15:00Z",
  });
  await newTouchpoint({
    person: last,
    channel: "ctwa",
    campaign: "edges",
    at: "2031-03-31T15:50:00Z",
  });
  // 2031-04-01T00:05 Kuala Lumpur — the day after the range.
  await newTouchpoint({
    person: after,
    channel: "ctwa",
    campaign: "edges",
    at: "2031-03-31T16:05:00Z",
  });

  const row = campaignOf(await campaignRows(viewer, RANGE), "edges");
  assert.equal(row?.leads, 2);
});

// §12.10: a merge never changes a campaign's total, and the person merged
// away is not a second person behind the row.
it("a merged-away person's touchpoints are counted once, under the survivor", async () => {
  const admin = await newUser("super_admin");
  const source = await newPerson();
  const target = await newPerson();
  await newTouchpoint({
    person: source,
    channel: "lead_form",
    campaign: "merged",
    firstTouch: true,
  });
  await newTouchpoint({
    person: target,
    channel: "lead_form",
    campaign: "merged",
  });

  const before = campaignOf(await campaignRows(admin, RANGE), "merged");
  assert.deepEqual(
    { leads: before?.leads, people: before?.people },
    {
      leads: 2,
      people: 2,
    },
  );

  await db()`SELECT merge_person(${source}, ${target}, ${admin.id})`;

  const after = campaignOf(await campaignRows(admin, RANGE), "merged");
  assert.deepEqual(
    { leads: after?.leads, people: after?.people },
    {
      leads: 2,
      people: 1,
    },
  );
});

it("a deleted person's touchpoints leave the counts", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  await newTouchpoint({ person, channel: "ctwa", campaign: "deleted_person" });
  assert.equal(
    campaignOf(await campaignRows(viewer, RANGE), "deleted_person")?.leads,
    1,
  );

  await db()`UPDATE person SET deleted_at = now() WHERE id = ${person}`;
  assert.equal(
    campaignOf(await campaignRows(viewer, RANGE), "deleted_person"),
    undefined,
  );
});

it("an empty range counts nothing rather than failing", async () => {
  const viewer = await newUser("marketing");
  const empty = adsReportQuerySchema.parse({
    from: "2031-05-01",
    to: "2031-05-02",
  });
  const table = await campaignRows(viewer, empty);
  assert.deepEqual(
    { rows: table.rows.length, total: table.total, dropped: table.dropped },
    {
      rows: 0,
      total: 0,
      dropped: 0,
    },
  );
});

it("every spend figure comes back null, never zero", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  await newTouchpoint({ person, channel: "ctwa", campaign: "no_spend" });

  const row = campaignOf(await campaignRows(viewer, RANGE), "no_spend");
  assert.equal(row?.spendMyr, null);
  assert.equal(row?.costPerLeadMyr, null);
  assert.equal(row?.impressions, null);
  assert.equal(row?.clicks, null);
});

it("earliestMetaTouchpoint is the oldest Meta touchpoint, ignoring the rest", async () => {
  const viewer = await newUser("marketing");
  const old = await newPerson();
  const google = await newPerson();
  // Older than anything the seed holds, so the floor is this row.
  await newTouchpoint({
    person: old,
    channel: "lead_form",
    at: "2019-01-02T04:00:00Z",
  });
  await newTouchpoint({
    person: google,
    source: "google",
    gclid: "gcl.2",
    at: "2018-01-02T04:00:00Z",
  });

  const earliest = await earliestMetaTouchpoint(viewer);
  assert.equal(earliest, new Date("2019-01-02T04:00:00Z").toISOString());
});

// §14 and §9.18: a hundred rows at most, the largest first, and the count of
// what was left out — never a silent prefix. One person carries all of them,
// so the fixture is 101 touchpoints rather than 101 people.
it("over a hundred campaigns: 100 rows, the rest counted as dropped", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  const rows = Array.from({ length: 101 }, (_, i) => ({
    person_id: person,
    channel: "ctwa",
    occurred_at: "2031-03-10T04:00:00Z",
    // The 101st campaign gets two touchpoints, so it is the largest and must
    // survive the cap while a one-lead campaign is dropped.
    utm_campaign: `cap_${String(i).padStart(3, "0")}`,
  }));
  await db()`INSERT INTO touchpoint ${db()(rows)}`;
  await newTouchpoint({
    person,
    channel: "ctwa",
    campaign: "cap_100",
  });

  const table = await campaignRows(viewer, RANGE);
  assert.equal(table.rows.length, 100, "the cap");
  assert.equal(table.dropped, 1, "101 campaigns, 100 shown");
  assert.equal(table.total, 102);
  assert.equal(table.rows[0]?.campaign, "cap_100", "largest first");
});

// §9.18 leads per week, against real rows: Kuala Lumpur weeks, per channel.
it("leads per week: grouped by Kuala Lumpur week and channel", async () => {
  const viewer = await newUser("marketing");
  const a = await newPerson();
  const b = await newPerson();
  const c = await newPerson();
  // 2031-03-03 is a Monday. These two are in that week, Kuala Lumpur time.
  await newTouchpoint({
    person: a,
    channel: "lead_form",
    at: "2031-03-03T02:00:00Z",
  });
  await newTouchpoint({
    person: b,
    channel: "ctwa",
    at: "2031-03-08T02:00:00Z",
  });
  // 2031-03-09T16:05Z is 2031-03-10 00:05 in Kuala Lumpur: the NEXT week.
  await newTouchpoint({
    person: c,
    channel: "ctwa",
    at: "2031-03-09T16:05:00Z",
  });

  const { channels, weeks, peak } = await leadsPerWeek(viewer, RANGE);
  const week = (start: string) => weeks.find((w) => w.weekStart === start);
  assert.deepEqual(channels.sort(), ["ctwa", "lead_form"]);
  assert.equal(week("2031-03-03")?.total, 2);
  assert.equal(week("2031-03-03")?.byChannel.lead_form, 1);
  assert.equal(
    week("2031-03-10")?.total,
    1,
    "the Sunday-night lead is next week",
  );
  assert.equal(peak, 1);
});

it("leads per week: the range's empty weeks are present as zero", async () => {
  const viewer = await newUser("marketing");
  const { weeks } = await leadsPerWeek(viewer, RANGE);
  // 2031-03-01 to 2031-03-31 spans six Mondays: 24 Feb, then 3, 10, 17, 24
  // and 31 March — the last day is itself a Monday.
  assert.equal(weeks.length, 6);
  assert.ok(weeks.every((w) => typeof w.total === "number"));
});

it("leads per week: part_time is refused", async () => {
  const partTime = await newUser("part_time");
  await assert.rejects(() => leadsPerWeek(partTime, RANGE), PermissionError);
});

// §9.18 efficiency map, the signups half: seat-holding enrolments credited to
// the campaign of the buyer's first touch (O30 is why it is per person).
it("signups per campaign: credited to the first touch, HRDC counted", async () => {
  const viewer = await newUser("marketing");
  const course = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES (${crypto.randomUUID().slice(0, 12)}, 'Signup course', 'workshop', 1, 900)
    RETURNING id`;
  const [cls] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, price_myr, status)
    VALUES (${course[0].id}, ${crypto.randomUUID().slice(0, 12)},
            current_date + 20, current_date + 20, 'en', 'online',
            'https://lead.test/c', 50, 900, 'open')
    RETURNING id`;

  const buy = async (funding: string | null, campaign: string) => {
    const person = await newPerson();
    await newTouchpoint({
      person,
      channel: "lead_form",
      campaign,
      firstTouch: true,
    });
    let dealId: string | null = null;
    if (funding) {
      const [d] = await db()`
        INSERT INTO deal (pipeline, stage, person_id, funding_type, won_at)
        VALUES ('individual', 'won', ${person}, ${funding}, now())
        RETURNING id`;
      dealId = d.id;
    }
    // Inside RANGE: signupsPerCampaign ranges on when the seat was taken,
    // not on when the lead first arrived — a September lead buying in October
    // is an October signup.
    await db()`
      INSERT INTO enrolment (person_id, class_id, deal_id, status, created_at)
      VALUES (${person}, ${cls.id}, ${dealId}, 'confirmed',
              '2031-03-12T02:00:00Z')`;
  };

  await buy("hrdc", "eff_a");
  await buy("hrdc", "eff_a");
  await buy("self", "eff_a");
  await buy(null, "eff_b");

  const rows = await signupsPerCampaign(viewer, RANGE);
  const a = rows.find((r) => r.campaign === "eff_a");
  assert.deepEqual(
    { signups: a?.signups, hrdc: a?.hrdcSignups },
    {
      signups: 3,
      hrdc: 2,
    },
  );
  // No deal means no recorded funding, so it is not counted as HRDC.
  const b = rows.find((r) => r.campaign === "eff_b");
  assert.deepEqual(
    { signups: b?.signups, hrdc: b?.hrdcSignups },
    {
      signups: 1,
      hrdc: 0,
    },
  );
});

it("signups per campaign: a lead who never bought is not a signup", async () => {
  const viewer = await newUser("marketing");
  const person = await newPerson();
  await newTouchpoint({
    person,
    channel: "lead_form",
    campaign: "eff_nobuy",
    firstTouch: true,
  });
  const rows = await signupsPerCampaign(viewer, RANGE);
  assert.equal(
    rows.find((r) => r.campaign === "eff_nobuy"),
    undefined,
  );
});

it("signups per campaign: part_time is refused", async () => {
  const partTime = await newUser("part_time");
  await assert.rejects(
    () => signupsPerCampaign(partTime, RANGE),
    PermissionError,
  );
});
