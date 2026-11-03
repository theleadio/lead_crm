import type postgres from "postgres";
import {
  PermissionError,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { seatTakenSql } from "../classes/seats.ts";
import { lmsHrdcEnrollmentIds } from "../lms/read.ts";
import { db } from "../sql.ts";
import type { AdsReportQuery } from "../validation/report.ts";
import { SIZE_FLOOR } from "./class-size.ts";
import {
  NO_SPEND,
  type AdsCampaignRow,
  type AdsSourceRow,
  type AdsTable,
  type AdsWeekRow,
  type AdsWeeks,
  type CampaignSignups,
} from "./types.ts";

// Service layer for the §9.18 ads report. Three independent reads over
// `touchpoint`, each permission-checked on its own, none of them writing.
// No ad platform table is touched: §5 defers `campaign`, `ad` and
// `ad_metric_daily` to January, so spend stays null (see types.ts).

// §14 and §9.18: a hundred report rows, plus the count of what was left out.
const ROWS_SHOWN = 100;

// O63, the one definition of a Meta touchpoint. Written once and shared by
// every query here, so the two tables and their totals can never disagree
// about which rows they counted. Lead Ads and click-to-WhatsApp arrive
// through `channel`; a paid click carries `fbclid` or `ctwa_clid`; and a
// tagged link carries one of these sources, however it was cased.
export const META_CHANNELS = ["lead_form", "ctwa"] as const;
export const META_SOURCES = [
  "facebook",
  "instagram",
  "fb",
  "ig",
  "meta",
] as const;

// §9.18 class size: big, middle and small are bands on the course's own list
// price (lib/reports/class-size.ts), so the filter is a price range rather
// than a name or a track. An unpriced course is in no band, which is why a
// filtered view uses an inner comparison and not COALESCE.
function sizeSql(sql: postgres.Sql, q: AdsReportQuery) {
  if (!q.size) return sql``;
  const price = sql`co.list_price_myr`;
  if (q.size === "big") return sql`AND ${price} >= ${SIZE_FLOOR.big}`;
  if (q.size === "middle")
    return sql`AND ${price} >= ${SIZE_FLOOR.middle} AND ${price} < ${SIZE_FLOOR.big}`;
  return sql`AND ${price} > 0 AND ${price} < ${SIZE_FLOOR.middle}`;
}

// `alias` is the touchpoint table's alias in the calling query.
export function metaTouchpointSql(sql: postgres.Sql, alias = "t") {
  const channel = sql(`${alias}.channel`);
  const fbclid = sql(`${alias}.fbclid`);
  const ctwaClid = sql(`${alias}.ctwa_clid`);
  const source = sql(`${alias}.utm_source`);
  return sql`(${channel} IN ${sql(META_CHANNELS)}
              OR ${fbclid} IS NOT NULL
              OR ${ctwaClid} IS NOT NULL
              OR lower(btrim(${source})) IN ${sql(META_SOURCES)})`;
}

// Spec §4: whole Kuala Lumpur days, both ends inclusive. A half-open upper
// bound rather than `<= end of day`, so nothing late on the last day is
// lost. Copied from the §9.5 deals list, which ranges the same way.
function rangeSql(sql: postgres.Sql, q: AdsReportQuery, alias = "t") {
  const occurred = sql(`${alias}.occurred_at`);
  return sql`${occurred} >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
         AND ${occurred} < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`;
}

// §12.10: a deleted or merged-away person's touchpoints are gone from every
// count, so a merge never changes a campaign's total.
function livePersonSql(sql: postgres.Sql) {
  return sql`p.deleted_at IS NULL AND p.merged_into_id IS NULL`;
}

// The screen checks the same thing before it renders, but the service is
// what the §6 matrix is enforced in: a caller that skips the screen is
// refused here. The §6 matrix has no Reports row, so the report rides on
// person read, and the part_time "assigned only" kind of read does not open
// an aggregate over everyone's leads (O62).
export function requireReportReader(viewer: Viewer): void {
  const { assignedOnly } = requirePermission(viewer, "person", "read");
  if (assignedOnly) throw new PermissionError("person");
}

export async function campaignRows(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<AdsTable<AdsCampaignRow>> {
  requireReportReader(viewer);
  const sql = db();

  // The windows run over every group, before LIMIT, so `total_leads` and
  // `group_count` describe the whole range rather than the page shown.
  // utm_campaign NULL is its own group — the leads that carry no campaign
  // are a row, never dropped, so the rows sum to the total.
  const rows = await sql`
    WITH meta AS (
      SELECT t.utm_campaign, t.is_first_touch, t.person_id
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      WHERE ${metaTouchpointSql(sql)}
        AND ${rangeSql(sql, q)}
        AND ${livePersonSql(sql)}
    )
    SELECT utm_campaign AS campaign,
           count(*)::int AS leads,
           count(*) FILTER (WHERE is_first_touch)::int AS first_touch,
           count(*) FILTER (WHERE NOT is_first_touch)::int AS later_touch,
           count(DISTINCT person_id)::int AS people,
           (count(*) OVER ())::int AS group_count,
           (sum(count(*)) OVER ())::int AS total_leads
    FROM meta
    GROUP BY utm_campaign
    ORDER BY leads DESC, campaign ASC NULLS LAST
    LIMIT ${ROWS_SHOWN}`;

  return {
    rows: rows.map((r) => ({
      campaign: r.campaign,
      leads: r.leads,
      firstTouch: r.first_touch,
      laterTouch: r.later_touch,
      people: r.people,
      ...NO_SPEND,
    })),
    total: rows[0]?.total_leads ?? 0,
    dropped: Math.max(0, (rows[0]?.group_count ?? 0) - rows.length),
  };
}

export async function sourceRows(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<AdsTable<AdsSourceRow>> {
  requireReportReader(viewer);
  const sql = db();

  // The cap is on report rows — the hundred biggest sources — and each one's
  // channel split rides along, so `lead_form` and `ctwa` can be told apart
  // without a second screen. `IS NOT DISTINCT FROM` joins the NULL source to
  // its own group, which `=` would drop.
  const rows = await sql`
    WITH meta AS (
      SELECT t.utm_source, t.channel
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      WHERE ${metaTouchpointSql(sql)}
        AND ${rangeSql(sql, q)}
        AND ${livePersonSql(sql)}
    ),
    sources AS (
      SELECT utm_source, count(*)::int AS leads,
             (count(*) OVER ())::int AS group_count,
             (sum(count(*)) OVER ())::int AS total_leads
      FROM meta
      GROUP BY utm_source
    ),
    top AS (
      SELECT * FROM sources
      ORDER BY leads DESC, utm_source ASC NULLS LAST
      LIMIT ${ROWS_SHOWN}
    )
    SELECT top.utm_source AS source, top.leads, top.group_count,
           top.total_leads, m.channel, count(*)::int AS channel_leads
    FROM top
    JOIN meta m ON m.utm_source IS NOT DISTINCT FROM top.utm_source
    GROUP BY top.utm_source, top.leads, top.group_count, top.total_leads,
             m.channel
    ORDER BY top.leads DESC, top.utm_source ASC NULLS LAST,
             channel_leads DESC, m.channel ASC`;

  // One row per source and channel comes back; fold the channels into the
  // source row they belong to, keeping the order the query set.
  const bySource = new Map<string | null, AdsSourceRow>();
  for (const r of rows) {
    const existing = bySource.get(r.source);
    const row: AdsSourceRow = existing ?? {
      source: r.source,
      leads: r.leads,
      byChannel: [],
      ...NO_SPEND,
    };
    row.byChannel.push({ channel: r.channel, leads: r.channel_leads });
    if (!existing) bySource.set(r.source, row);
  }

  return {
    rows: [...bySource.values()],
    total: rows[0]?.total_leads ?? 0,
    dropped: Math.max(0, (rows[0]?.group_count ?? 0) - bySource.size),
  };
}

// §9.18: the screen says how far back its data goes, so a range reaching
// before the first captured touchpoint is not read as a quiet month with no
// leads. No range on this one — it is the floor of all of them.
export async function earliestMetaTouchpoint(
  viewer: Viewer,
): Promise<string | null> {
  requireReportReader(viewer);
  const sql = db();
  const [row] = await sql`
    SELECT min(t.occurred_at) AS earliest
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE ${metaTouchpointSql(sql)} AND ${livePersonSql(sql)}`;
  return row?.earliest ? new Date(row.earliest).toISOString() : null;
}

// §9.18 leads over time. Weeks are Kuala Lumpur weeks (§4): `date_trunc`
// runs on the local timestamp, so a lead late on a Sunday night counts in the
// week it happened locally, not the week UTC was in.
//
// Weeks with no leads are filled in rather than skipped — a gap drawn as a
// missing column reads as a quiet week, which is true; a gap drawn as no
// column at all silently shortens the axis and hides it.
export async function leadsPerWeek(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<AdsWeeks> {
  requireReportReader(viewer);
  const sql = db();

  const rows = await sql`
    SELECT to_char(date_trunc('week',
             t.occurred_at AT TIME ZONE 'Asia/Kuala_Lumpur'),
             'YYYY-MM-DD') AS week_start,
           t.channel,
           count(*)::int AS leads
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE ${metaTouchpointSql(sql)}
      AND ${rangeSql(sql, q)}
      AND ${livePersonSql(sql)}
    GROUP BY week_start, t.channel
    ORDER BY week_start ASC, leads DESC`;

  const totals = new Map<string, number>();
  const weeks = new Map<string, AdsWeekRow>();
  for (const r of rows) {
    totals.set(r.channel, (totals.get(r.channel) ?? 0) + r.leads);
    const week =
      weeks.get(r.week_start) ??
      ({ weekStart: r.week_start, total: 0, byChannel: {} } as AdsWeekRow);
    week.byChannel[r.channel] = r.leads;
    week.total += r.leads;
    weeks.set(r.week_start, week);
  }

  const channels = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([channel]) => channel);

  return {
    channels,
    weeks: fillWeeks([...weeks.values()], q, channels),
    peak: Math.max(
      0,
      ...[...weeks.values()].flatMap((w) =>
        channels.map((c) => w.byChannel[c] ?? 0),
      ),
    ),
  };
}

// Pure, so the week arithmetic is testable without a database. Walks Mondays
// from the week the range starts in to the week it ends in, so an empty week
// inside the range is a zero rather than a hole.
export function fillWeeks(
  found: AdsWeekRow[],
  q: AdsReportQuery,
  channels: string[],
): AdsWeekRow[] {
  const byWeek = new Map(found.map((w) => [w.weekStart, w]));
  const out: AdsWeekRow[] = [];
  const DAY = 24 * 60 * 60 * 1000;
  // Date.UTC on a plain date, then back to the Monday: the dates carry no
  // time, so there is no zone to lose (§4, Kuala Lumpur has no DST).
  const monday = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    // getUTCDay: 0 is Sunday, and a Postgres week starts on Monday.
    const shift = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - shift * DAY);
  };
  const last = monday(q.to).getTime();
  for (let at = monday(q.from); at.getTime() <= last;) {
    const key = at.toISOString().slice(0, 10);
    out.push(
      byWeek.get(key) ?? {
        weekStart: key,
        total: 0,
        byChannel: Object.fromEntries(channels.map((c) => [c, 0])),
      },
    );
    at = new Date(at.getTime() + 7 * DAY);
  }
  return out;
}

// §9.18 efficiency map, the half that needs no ad tables: seat-holding
// enrolments (§12.1) credited to the campaign of the buyer's first touch.
//
// First touch per person, not per deal: O30 means a deal does not record the
// touchpoint that created it, so this is the honest model available, and the
// panel states it. A person who bought twice credits one campaign twice.
export async function signupsPerCampaign(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<CampaignSignups[]> {
  requireReportReader(viewer);
  const sql = db();

  // Credited to the campaign that first found the buyer, per person — the
  // model the panel names (O30 is what stops it being per deal).
  //
  // "First" is the earliest touchpoint carrying a campaign id, not the
  // `is_first_touch` flag: the SalesProcess attribution import appends rows
  // without setting it, so the flag is false on all 3,241 of them and
  // trusting it credits nobody. `occurred_at` is what the flag was standing
  // in for, and the id breaks a tie so the answer is stable.
  //
  // The join is on `utm_campaign_id`, not the campaign name. Names vary in
  // Meta's own data ("WhatsApp" against "Whatsapp") and are retyped per run;
  // the id is the thing Meta and the lead both carry.
  // A synced seat has no deal, so the deal alone reports 0 HRDC however many
  // grant seats the LMS holds. The LMS ids top it up; an LMS that cannot be
  // reached leaves the deal-only count rather than failing the report.
  const lmsHrdcIds = await lmsHrdcEnrollmentIds().catch(() => [] as string[]);

  const rows = await sql`
    WITH first_touch AS (
      SELECT DISTINCT ON (t.person_id)
             t.person_id, t.utm_campaign_id, t.utm_campaign
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      WHERE t.utm_campaign_id IS NOT NULL
        AND ${metaTouchpointSql(sql)}
        AND ${livePersonSql(sql)}
      ORDER BY t.person_id, t.occurred_at ASC, t.id ASC
    )
    SELECT f.utm_campaign_id AS campaign_id,
           max(f.utm_campaign) AS campaign,
           count(*)::int AS signups,
           count(*) FILTER (
             WHERE d.funding_type = 'hrdc' OR e.id = ANY(${lmsHrdcIds}::uuid[])
           )::int AS hrdc_signups
    FROM first_touch f
    JOIN enrolment e ON e.person_id = f.person_id
    JOIN class cl ON cl.id = e.class_id
    JOIN course co ON co.id = cl.course_id
    LEFT JOIN deal d ON d.id = e.deal_id
    WHERE ${seatTakenSql(sql)}
      ${sizeSql(sql, q)}
      AND e.created_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
      AND e.created_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    GROUP BY f.utm_campaign_id
    ORDER BY signups DESC, campaign_id ASC
    LIMIT ${ROWS_SHOWN}`;

  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaign: r.campaign,
    signups: r.signups,
    hrdcSignups: r.hrdc_signups,
  }));
}
