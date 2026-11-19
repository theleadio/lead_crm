// The weekly summary at the top of §9.18: how many signed up, how many are
// still to pay, what the ads cost, and which ad brought whom. Agreed with the
// owner on 18 Nov (docs/superpowers/notes/2026-11-18-weekly-ads-report-proposal.md).
// Signups come from three places: paid seats, paid SalesProcess orders with no
// seat yet, and the ops team's participant sheet (migration 026, Part 2).
//
// The database returns plain rows and `summarise` does the arithmetic, so
// the week, class and ad grouping is tested without a database. No row
// carries a name or contact detail: person ids are counted, never shown.

import type postgres from "postgres";
import { PRODUCT_COURSE } from "../import/salesprocess-enrolments.ts";
import { sumMyr } from "../format/money.ts";
import { db } from "../sql.ts";
import type { Viewer } from "../auth/permissions.ts";
import { kualaLumpurDay, type AdsReportQuery } from "../validation/report.ts";
import {
  campaignMapSql,
  daysInRange,
  firstCampaignSql,
  livePersonSql,
  metaTouchpointSql,
  requireReportReader,
  sizeSql,
} from "./ads.ts";

// How a signup's person was matched to an ad, checked in this order.
// meta: their first Meta touch resolves to a campaign. meta_no_id: they came
// from Meta, but no campaign or ad id survives. self: the sheet's Source column
// says how they came (referral, returning student...), never a specific ad.
// other: some other recorded source (Google, email, a form). none: nothing
// but the bare import row.
export type Matched = "meta" | "meta_no_id" | "self" | "other" | "none";

export type SignupRow = {
  personId: string;
  classId: string | null;
  courseId: string | null;
  at: Date | string;
  hrdc: boolean;
  // seat: a paid-for enrolment. order: a paid SalesProcess order from
  // someone holding no seat in range (most orders become seats on import).
  // sheet: a row of the participant sheet for someone with no seat or order
  // in that class.
  source: "seat" | "order" | "sheet";
  // A sheet row loaded by the history backfill: dated by the class date, not
  // by when it reached the CRM.
  approx?: boolean;
  campaignId: string | null;
  adId: string | null;
  matched: Matched;
  // When their first Meta touch happened; null when there is none before the
  // signup.
  firstTouchAt: Date | string | null;
};

export type PendingRow = {
  classId: string;
  courseId: string;
  at: Date | string;
};

// One ad's spend in one Monday-start week. Meta's day is already a Kuala
// Lumpur day (see ad-spend.ts), so the week needs no conversion.
export type SpendRow = {
  weekStart: string;
  campaignId: string;
  adId: string;
  currency: string;
  spend: string;
};

export type ClassInfo = {
  // A class id, or `course:<id>` for an order whose class is not known.
  key: string;
  name: string;
  workshop: boolean;
};

export type WeeklyInput = {
  signups: SignupRow[];
  pending: PendingRow[];
  spend: SpendRow[];
  classes: ClassInfo[];
  // Meta campaign id to class id (`class_meta_campaign`).
  campaignClass: [string, string][];
  adNames: [string, string][];
  // Ad id to the name of the campaign it runs in, so same-named ads read apart.
  adCampaignNames?: [string, string][];
  // The sheet's class labels with no CRM class yet, and how many people each
  // holds in range, so someone can map them (`npm run participants:map`).
  sheetUnmapped?: { label: string; people: number }[];
  // When a sheet row last reached the CRM (null: nothing synced yet).
  sheetLastSeen?: Date | string | null;
};

export type WeekRow = {
  weekStart: string;
  // Days of this week the range covers; under 7 means a partial week.
  days: number;
  // Some of this week's signups are dated by their class, not their signup.
  approx: boolean;
  signups: number;
  metaSignups: number;
  pending: number;
  spend: string;
};

// A week of first ad touch: what Meta spent that week, and how many of the
// range's Meta signups first met an ad that week (whenever they signed up).
export type CohortRow = {
  weekStart: string;
  spend: string;
  metaSignups: number;
};

export type ClassRow = {
  key: string;
  name: string | null;
  workshop: boolean | null;
  signups: number;
  hrdc: number;
  meta: number;
  pending: number;
  spend: string | null;
  topAd: string | null;
};

export type AdRow = {
  adId: string;
  adName: string;
  campaignName: string | null;
  className: string | null;
  signups: number;
  spend: string;
  // Brought a signup in range but spent nothing in range: its spend came
  // before the range, so a dash would read as "free".
  spentEarlier: boolean;
};

export type WeeklySummary = {
  weeks: WeekRow[];
  cohorts: CohortRow[];
  // Meta signups whose first touch was before the range's first week.
  cohortBefore: number;
  // The range's last week, and the week before it cut to the same number of
  // days, so a Wednesday is compared with last Wednesday and not a full week.
  latest: WeekRow;
  previous: { signups: number; pending: number };
  totals: WeekRow;
  sources: { seat: number; order: number; sheet: number };
  sheetUnmapped: { label: string; people: number }[];
  sheetLastSeen: string | null;
  match: Record<Matched, number>;
  classes: ClassRow[];
  unlinkedSpend: string;
  ads: AdRow[];
  adsDropped: number;
};

const DAY = 86_400_000;
export const ADS_SHOWN = 30;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

// The Kuala Lumpur day of a timestamp, then the Monday of that day's week.
export function klDay(at: Date | string): string {
  return kualaLumpurDay(new Date(at));
}
export function mondayOf(day: string): string {
  const ms = dayMs(day);
  const shift = (new Date(ms).getUTCDay() + 6) % 7;
  return ymd(ms - shift * DAY);
}

// Seven days earlier, as the summary also reads the week before the range
// for its comparison.
export function weekBefore(day: string): string {
  return ymd(dayMs(day) - 7 * DAY);
}

const classKey = (r: { classId: string | null; courseId: string | null }) =>
  r.classId ?? (r.courseId ? `course:${r.courseId}` : "none");

function tally<K>(map: Map<K, number>, key: K, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function summarise(
  input: WeeklyInput,
  q: AdsReportQuery,
): WeeklySummary {
  const inRange = (day: string) => day >= q.from && day <= q.to;
  const signups = input.signups
    .map((s) => ({ ...s, day: klDay(s.at) }))
    .filter((s) => inRange(s.day));
  const pending = input.pending
    .map((p) => ({ ...p, day: klDay(p.at) }))
    .filter((p) => inRange(p.day));
  // Already ranged on Meta's day by the query.
  const spend = input.spend;
  // Money from two currencies is never added (§12.7, as `assertOneCurrency`).
  const currencies = new Set(spend.map((s) => s.currency));
  if (currencies.size > 1 || (currencies.size === 1 && !currencies.has("MYR")))
    throw new Error("Ad spend is not all in MYR");

  // Weeks, every Monday from the range's first to its last, empty ones kept.
  const weeks: WeekRow[] = [];
  for (let at = dayMs(mondayOf(q.from)); at <= dayMs(q.to); at += 7 * DAY) {
    const weekStart = ymd(at);
    const own = <T extends { day: string }>(rows: T[]) =>
      rows.filter((r) => mondayOf(r.day) === weekStart);
    const weekSignups = own(signups);
    weeks.push({
      weekStart,
      days: daysInRange(weekStart, q.from, q.to),
      approx: weekSignups.some((s) => s.approx),
      signups: weekSignups.length,
      metaSignups: weekSignups.filter((s) => s.matched === "meta").length,
      pending: own(pending).length,
      spend: sumMyr(
        spend.filter((s) => s.weekStart === weekStart).map((s) => s.spend),
      ),
    });
  }
  const latest = weeks[weeks.length - 1];

  // By first touch: the same weeks, but each Meta signup counts in the week
  // of its first ad touch, so signups that lag the spend land beside it.
  const touched = new Map<string, number>();
  let cohortBefore = 0;
  for (const s of signups) {
    if (s.matched !== "meta" || !s.firstTouchAt) continue;
    const week = mondayOf(klDay(s.firstTouchAt));
    if (week < weeks[0].weekStart) cohortBefore += 1;
    else tally(touched, week);
  }
  const cohorts = weeks.map((w): CohortRow => ({
    weekStart: w.weekStart,
    spend: w.spend,
    metaSignups: touched.get(w.weekStart) ?? 0,
  }));

  // The week before the latest one, over as many days as the latest has
  // had. Read from the rows before the range, which the load fetched for this.
  const latestFirst = latest.weekStart < q.from ? q.from : latest.weekStart;
  const prevFrom = weekBefore(latestFirst);
  const prevTo = ymd(dayMs(prevFrom) + (latest.days - 1) * DAY);
  const prevWindow = (day: string) => day >= prevFrom && day <= prevTo;
  const previous = {
    signups: input.signups.filter((s) => prevWindow(klDay(s.at))).length,
    pending: input.pending.filter((p) => prevWindow(klDay(p.at))).length,
  };

  const totals: WeekRow = {
    weekStart: q.from,
    days: (dayMs(q.to) - dayMs(q.from)) / DAY + 1,
    approx: signups.some((s) => s.approx),
    signups: signups.length,
    metaSignups: signups.filter((s) => s.matched === "meta").length,
    pending: pending.length,
    spend: sumMyr(spend.map((s) => s.spend)),
  };

  const match: Record<Matched, number> = {
    meta: 0,
    meta_no_id: 0,
    self: 0,
    other: 0,
    none: 0,
  };
  for (const s of signups) match[s.matched] += 1;

  // Spend by class goes through `class_meta_campaign`; a campaign linked to
  // no class is its own row, so the class rows still add up to the total.
  const classOfCampaign = new Map(input.campaignClass);
  const info = new Map(input.classes.map((c) => [c.key, c]));
  const adName = new Map(input.adNames);
  const adCampaignName = new Map(input.adCampaignNames ?? []);
  const spendByClass = new Map<string, string[]>();
  const unlinked: string[] = [];
  for (const s of spend) {
    const cls = classOfCampaign.get(s.campaignId);
    if (cls) spendByClass.set(cls, [...(spendByClass.get(cls) ?? []), s.spend]);
    else unlinked.push(s.spend);
  }

  const byClass = new Map<string, ClassRow>();
  const row = (key: string) => {
    let r = byClass.get(key);
    if (!r) {
      const c = info.get(key);
      r = {
        key,
        name: c?.name ?? null,
        workshop: c?.workshop ?? null,
        signups: 0,
        hrdc: 0,
        meta: 0,
        pending: 0,
        spend: spendByClass.has(key) ? sumMyr(spendByClass.get(key)!) : null,
        topAd: null,
      };
      byClass.set(key, r);
    }
    return r;
  };
  const adsPerClass = new Map<string, Map<string, number>>();
  for (const s of signups) {
    const r = row(classKey(s));
    r.signups += 1;
    if (s.hrdc) r.hrdc += 1;
    if (s.matched === "meta") r.meta += 1;
    if (s.adId) {
      const counts = adsPerClass.get(r.key) ?? new Map<string, number>();
      tally(counts, s.adId);
      adsPerClass.set(r.key, counts);
    }
  }
  for (const p of pending) row(classKey(p)).pending += 1;
  for (const key of spendByClass.keys()) row(key);
  for (const [key, counts] of adsPerClass) {
    // Ties go to the smaller id, so the answer is the same on every load.
    const [top] = [...counts].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    );
    byClass.get(key)!.topAd = adName.get(top[0]) ?? top[0];
  }
  const classes = [...byClass.values()].sort(
    (a, b) =>
      b.signups - a.signups ||
      b.pending - a.pending ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );

  // Ads: every ad that brought a signup or spent in range, the spenders that
  // brought nobody included — an ad that costs and brings no one is a finding.
  const adSignups = new Map<string, number>();
  const adCampaign = new Map<string, string>();
  for (const s of signups)
    if (s.adId) {
      tally(adSignups, s.adId);
      if (s.campaignId) adCampaign.set(s.adId, s.campaignId);
    }
  const adSpend = new Map<string, string[]>();
  for (const s of spend) {
    adSpend.set(s.adId, [...(adSpend.get(s.adId) ?? []), s.spend]);
    adCampaign.set(s.adId, s.campaignId);
  }
  const allAds = [...new Set([...adSignups.keys(), ...adSpend.keys()])].map(
    (adId): AdRow => {
      const cls = classOfCampaign.get(adCampaign.get(adId) ?? "");
      return {
        adId,
        adName: adName.get(adId) ?? adId,
        campaignName: adCampaignName.get(adId) ?? null,
        className: cls ? (info.get(cls)?.name ?? null) : null,
        signups: adSignups.get(adId) ?? 0,
        spend: sumMyr(adSpend.get(adId) ?? []),
        spentEarlier: adSignups.has(adId) && !adSpend.has(adId),
      };
    },
  );
  allAds.sort(
    (a, b) =>
      b.signups - a.signups ||
      Number(b.spend) - Number(a.spend) ||
      (a.adId < b.adId ? -1 : 1),
  );

  return {
    weeks,
    cohorts,
    cohortBefore,
    latest,
    previous,
    totals,
    sources: {
      seat: signups.filter((s) => s.source === "seat").length,
      order: signups.filter((s) => s.source === "order").length,
      sheet: signups.filter((s) => s.source === "sheet").length,
    },
    sheetUnmapped: input.sheetUnmapped ?? [],
    sheetLastSeen: input.sheetLastSeen
      ? new Date(input.sheetLastSeen).toISOString()
      : null,
    match,
    classes,
    unlinkedSpend: sumMyr(unlinked),
    ads: allAds.slice(0, ADS_SHOWN),
    adsDropped: Math.max(0, allAds.length - ADS_SHOWN),
  };
}

// Kuala Lumpur days, both ends inclusive, half-open on the timestamp (§4).
function between(sql: postgres.Sql, name: string, from: string, to: string) {
  const column = sql(name);
  return sql`${column} >= (${from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
         AND ${column} < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`;
}

// The statuses that mean a seat is paid for. `reserved` is a Stripe checkout
// hold and `payment_pending` is waiting on money (§12.1, §12.4), so both are
// pending, not signed up (Zhixuan's review, 18 Nov).
const PAID_SEAT = ["confirmed", "onboarded", "attended", "completed"];
// Any status that holds a seat or a pending one: a person with such an
// enrolment in a class is already counted there (as a signup or as pending),
// so the sheet's row for the same class adds nobody.
const HELD_SEAT = [...PAID_SEAT, "payment_pending", "reserved"];

// The sheet's Source column, written as a touchpoint by the sync (utm_source
// "self:referral"). It says how the student came, not which ad, so it is its
// own answer between "Meta" and "some other source".
const SELF_SOURCE_SQL = (sql: postgres.Sql) => sql`
  WHEN EXISTS (SELECT 1 FROM touchpoint t
               WHERE t.person_id = s.person_id
                 AND t.form_name = 'participant-sheet'
                 AND t.utm_source LIKE 'self:%') THEN 'self'`;

// The participant sheet's signups (migration 026): one per person and class,
// dated by when the row first reached the CRM. Run apart from the main query
// so a database without the 026 tables still draws the rest of the report.
async function sheetRows(sql: postgres.Sql, q: AdsReportQuery, from: string) {
  return sql`
    WITH ${campaignMapSql(sql)},
    ${firstCampaignSql(sql)},
    s AS (
      SELECT DISTINCT ON (r.id, coalesce(l.class_id::text, pe.label_norm || pe.class_date::text))
             r.id AS person_id, l.class_id, cl.course_id, pe.first_seen_at AS at,
             pe.hrdc, 'sheet' AS source, pe.approx_date AS approx
      FROM participant_entry pe
      JOIN person p0 ON p0.id = pe.person_id
      -- The surviving person of a merge: the sheet row stays with the one
      -- that was merged away, the report follows it.
      JOIN person r ON r.id = coalesce(p0.merged_into_id, p0.id)
      JOIN participant_class_label l
        ON l.label_norm = pe.label_norm AND l.class_date = pe.class_date
      LEFT JOIN class cl ON cl.id = l.class_id
      LEFT JOIN course co ON co.id = cl.course_id
      WHERE r.deleted_at IS NULL AND r.merged_into_id IS NULL
        ${sizeSql(sql, q)}
        AND ${between(sql, "pe.first_seen_at", from, q.to)}
        AND NOT EXISTS (SELECT 1 FROM enrolment e
                        WHERE e.person_id = r.id AND e.class_id = l.class_id
                          AND e.status IN ${sql(HELD_SEAT)})
      ORDER BY r.id, coalesce(l.class_id::text, pe.label_norm || pe.class_date::text),
               pe.first_seen_at
    )
    SELECT s.person_id, s.class_id, s.course_id, s.at, s.hrdc, s.source, s.approx,
           f.campaign_id, f.ad_id, f.occurred_at AS first_touch_at,
           CASE
             WHEN f.person_id IS NOT NULL THEN 'meta'
             WHEN EXISTS (SELECT 1 FROM touchpoint t
                          WHERE t.person_id = s.person_id
                            AND ${metaTouchpointSql(sql)}) THEN 'meta_no_id'
             ${SELF_SOURCE_SQL(sql)}
             WHEN EXISTS (SELECT 1 FROM touchpoint t
                          WHERE t.person_id = s.person_id
                            AND (t.channel <> 'import'
                                 OR t.utm_source IS NOT NULL
                                 OR t.utm_campaign IS NOT NULL
                                 OR t.gclid IS NOT NULL)) THEN 'other'
             ELSE 'none'
           END AS matched
    FROM s
    LEFT JOIN first_touch f ON f.person_id = s.person_id
                           AND f.occurred_at <= s.at`;
}

// Labels with no class, for the people who signed up in range, and when the
// sheet last reached the CRM.
async function sheetStatus(sql: postgres.Sql, q: AdsReportQuery, from: string) {
  const [unmapped, last] = await Promise.all([
    sql`
      SELECT l.raw_label AS label, count(DISTINCT pe.person_id)::int AS people
      FROM participant_class_label l
      JOIN participant_entry pe
        ON pe.label_norm = l.label_norm AND pe.class_date = l.class_date
      WHERE l.class_id IS NULL
        AND ${between(sql, "pe.first_seen_at", from, q.to)}
        AND NOT pe.approx_date
      GROUP BY l.raw_label ORDER BY people DESC, label LIMIT 10`,
    sql`SELECT max(first_seen_at) AS at FROM participant_entry
        WHERE NOT approx_date`,
  ]);
  return {
    unmapped: unmapped.map((r) => ({
      label: r.label as string,
      people: r.people as number,
    })),
    lastSeen: (last[0]?.at ?? null) as Date | null,
  };
}

export async function weeklySummary(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<WeeklySummary> {
  requireReportReader(viewer);
  const sql = db();
  // A week earlier than the range, for the latest week's comparison.
  const from = weekBefore(q.from);
  const to = q.to;
  const products = Object.keys(PRODUCT_COURSE);
  const codes = Object.values(PRODUCT_COURSE);
  const account = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");

  const [mainSignups, pending, spend, links] = await Promise.all([
    sql`
      WITH ${campaignMapSql(sql)},
      ${firstCampaignSql(sql)},
      seats AS (
        -- One person in one class is one signup, however often re-enrolled.
        SELECT DISTINCT ON (e.person_id, e.class_id)
               e.person_id, e.class_id, cl.course_id, e.created_at AS at,
               coalesce(e.funding_type = 'hrdc' OR d.funding_type = 'hrdc', false) AS hrdc,
               'seat' AS source
        FROM enrolment e
        JOIN person p ON p.id = e.person_id
        JOIN class cl ON cl.id = e.class_id
        JOIN course co ON co.id = cl.course_id
        LEFT JOIN deal d ON d.id = e.deal_id
        WHERE e.status IN ${sql(PAID_SEAT)}
          AND ${livePersonSql(sql)}
          ${sizeSql(sql, q)}
          AND ${between(sql, "e.created_at", from, to)}
        ORDER BY e.person_id, e.class_id, e.created_at
      ),
      product_course AS (
        SELECT * FROM unnest(${products}::text[], ${codes}::text[]) AS m(product, code)
      ),
      orders AS (
        -- As signupsPerCampaign: an order counts only from a buyer holding no
        -- seat in range, and an order paid in instalments counts once. Orders
        -- carry no class, so a class-size filter counts seats alone.
        SELECT DISTINCT ON (b.person_id, coalesce(sp.order_id, sp.id))
               b.person_id, NULL::uuid AS class_id, co.id AS course_id,
               sp.paid_at AS at, false AS hrdc, 'order' AS source
        FROM salesprocess_payment sp
        JOIN touchpoint b ON b.channel = 'import'
                         AND b.external_ref = 'ghl:' || sp.ghl_contact_id
        JOIN person p ON p.id = b.person_id
        LEFT JOIN product_course pc ON pc.product = sp.product
        LEFT JOIN course co ON co.code = pc.code
        WHERE ${q.size ? sql`false` : sql`true`}
          AND sp.live_mode
          AND sp.status IN ('succeeded', 'partially_refunded')
          AND sp.currency = 'MYR'
          AND ${between(sql, "sp.paid_at", from, to)}
          AND ${livePersonSql(sql)}
          AND b.person_id NOT IN (SELECT person_id FROM seats)
        ORDER BY b.person_id, coalesce(sp.order_id, sp.id), sp.paid_at
      ),
      s AS (SELECT * FROM seats UNION ALL SELECT * FROM orders)
      SELECT s.person_id, s.class_id, s.course_id, s.at, s.hrdc, s.source,
             f.campaign_id, f.ad_id, f.occurred_at AS first_touch_at,
             CASE
               WHEN f.person_id IS NOT NULL THEN 'meta'
               WHEN EXISTS (SELECT 1 FROM touchpoint t
                            WHERE t.person_id = s.person_id
                              AND ${metaTouchpointSql(sql)}) THEN 'meta_no_id'
               ${SELF_SOURCE_SQL(sql)}
               WHEN EXISTS (SELECT 1 FROM touchpoint t
                            WHERE t.person_id = s.person_id
                              AND (t.channel <> 'import'
                                   OR t.utm_source IS NOT NULL
                                   OR t.utm_campaign IS NOT NULL
                                   OR t.gclid IS NOT NULL)) THEN 'other'
               ELSE 'none'
             END AS matched
      FROM s
      -- An ad cannot have brought a signup that happened before it was seen.
      LEFT JOIN first_touch f ON f.person_id = s.person_id
                             AND f.occurred_at <= s.at`,
    sql`
      SELECT DISTINCT ON (e.person_id, e.class_id)
             e.class_id, cl.course_id, e.created_at AS at
      FROM enrolment e
      JOIN person p ON p.id = e.person_id
      JOIN class cl ON cl.id = e.class_id
      JOIN course co ON co.id = cl.course_id
      WHERE (e.status = 'payment_pending'
             -- A hold that has run out has freed its seat (seatTakenSql).
             OR (e.status = 'reserved' AND e.seat_reserved_until > now()))
        AND ${livePersonSql(sql)}
        ${sizeSql(sql, q)}
        AND ${between(sql, "e.created_at", from, to)}
      ORDER BY e.person_id, e.class_id, e.created_at`,
    sql`
      SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week_start,
             campaign_id, ad_id, currency, sum(spend)::numeric(14, 2)::text AS spend
      FROM meta_ad_insight
      WHERE day >= ${q.from}::date AND day <= ${q.to}::date
        ${account ? sql`AND account_id = ${account}` : sql``}
      GROUP BY 1, campaign_id, ad_id, currency`,
    sql`SELECT meta_campaign_id, class_id::text FROM class_meta_campaign`,
  ]);

  // The participant sheet. If its tables are not there yet (migration 026 not
  // applied) or the read fails, the report is drawn without it.
  let sheet: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let status: Awaited<ReturnType<typeof sheetStatus>> = {
    unmapped: [],
    lastSeen: null,
  };
  try {
    [sheet, status] = await Promise.all([
      sheetRows(sql, q, from),
      sheetStatus(sql, q, from),
    ]);
  } catch (err) {
    console.error("[ads report] participant sheet failed", err);
  }
  // A person with a paid SalesProcess order for the class's course already
  // counts there (orders carry a course, not a class).
  const ordered = new Set(
    mainSignups
      .filter((s) => s.source === "order" && s.course_id)
      .map((s) => `${s.person_id}|${s.course_id}`),
  );
  const signups = [
    ...mainSignups,
    ...sheet.filter((s) => !ordered.has(`${s.person_id}|${s.course_id}`)),
  ];

  const classIds = new Set<string>();
  const courseIds = new Set<string>();
  for (const r of [...signups, ...pending]) {
    if (r.class_id) classIds.add(r.class_id);
    else if (r.course_id) courseIds.add(r.course_id);
  }
  for (const l of links) classIds.add(l.class_id);
  const adIds = [
    ...new Set([...signups.map((s) => s.ad_id), ...spend.map((s) => s.ad_id)]),
  ].filter(Boolean) as string[];

  const [classRows, courseRows, adRows] = await Promise.all([
    sql`
      SELECT cl.id::text AS key, co.name_en, cl.start_date, co.track
      FROM class cl JOIN course co ON co.id = cl.course_id
      WHERE cl.id = ANY(${[...classIds]}::uuid[])`,
    sql`
      SELECT co.id::text AS id, co.name_en, co.track
      FROM course co WHERE co.id = ANY(${[...courseIds]}::uuid[])`,
    sql`
      SELECT ad_id, max(ad_name) AS ad_name,
             (array_agg(campaign_name ORDER BY day DESC))[1] AS campaign_name
      FROM meta_ad_insight
      WHERE ad_id = ANY(${adIds}::text[]) GROUP BY ad_id`,
  ]);

  return summarise(
    {
      signups: signups.map((r) => ({
        personId: r.person_id,
        classId: r.class_id,
        courseId: r.course_id,
        at: r.at,
        hrdc: r.hrdc,
        source: r.source,
        approx: Boolean(r.approx),
        campaignId: r.campaign_id,
        adId: r.ad_id,
        matched: r.matched,
        firstTouchAt: r.first_touch_at ?? null,
      })),
      pending: pending.map((r) => ({
        classId: r.class_id,
        courseId: r.course_id,
        at: r.at,
      })),
      spend: spend.map((r) => ({
        weekStart: r.week_start,
        campaignId: r.campaign_id,
        adId: r.ad_id,
        currency: r.currency,
        spend: r.spend,
      })),
      classes: [
        ...classRows.map((c) => ({
          key: c.key,
          name: `${c.name_en} · ${formatClassDate(c.start_date)}`,
          workshop: c.track === "workshop",
        })),
        ...courseRows.map((c) => ({
          key: `course:${c.id}`,
          name: `${c.name_en} · no class yet`,
          workshop: c.track === "workshop",
        })),
      ],
      campaignClass: links.map((l) => [l.meta_campaign_id, l.class_id]),
      adNames: adRows.map((a) => [a.ad_id, a.ad_name]),
      adCampaignNames: adRows
        .filter((a) => a.campaign_name)
        .map((a) => [a.ad_id, a.campaign_name]),
      sheetUnmapped: status.unmapped,
      sheetLastSeen: status.lastSeen,
    },
    q,
  );
}

// "6 Dec 2026": the class's own date, so two runs of one course read apart.
function formatClassDate(d: Date | string | null): string {
  if (!d) return "no date";
  const day =
    d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
