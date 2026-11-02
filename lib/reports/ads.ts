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

// O63 for the campaign id. SalesProcess does not always fill
// `utm_campaign_id`, but it does fill `utm_content` with the Meta ad id and
// `utm_term` with the ad set id, and `meta_ad_insight` carries all three. An
// id that is missing can therefore be looked up from the ad, or failing that
// the ad set, the lead arrived on. 3,242 touchpoints carry a campaign id
// outright; 5,555 resolve this way, over 107 campaigns rather than 76.
//
// `utm_ad_id` is tried before `utm_content`: where the attribution import
// stored an explicit ad id, `utm_content` holds the creative's name instead.
// On 2 Nov every such row already carried its campaign id, so this adds no
// leads today; it stops one being lost the day a row arrives without.
//
// The stored id is tried first and wins where both exist. Exactly one
// touchpoint's ad disagrees with its stored id, and the id the lead itself
// carried is the better evidence of where that lead came from.
//
// `min(campaign_id)` is a one-row-per-key guard rather than a choice between
// campaigns: no ad id and no ad set id in this account maps to more than one
// campaign. If one ever did, the join would multiply rows and quietly inflate
// every lead count on the page, which is the failure worth preventing.
//
// Scoped to META_AD_ACCOUNT_ID the same way the spend side is
// (`adSpendRows`), so a lead is never resolved to a campaign whose spend the
// report then leaves out.
export function campaignMapSql(sql: postgres.Sql) {
  const account = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");
  const inAccount = account ? sql`AND account_id = ${account}` : sql``;
  return sql`
    ad_campaign AS (
      SELECT ad_id, min(campaign_id) AS campaign_id
      FROM meta_ad_insight WHERE ad_id IS NOT NULL ${inAccount}
      GROUP BY ad_id
    ),
    adset_campaign AS (
      SELECT adset_id, min(campaign_id) AS campaign_id
      FROM meta_ad_insight WHERE adset_id IS NOT NULL ${inAccount}
      GROUP BY adset_id
    ),
    campaign_name AS (
      SELECT campaign_id, max(campaign_name) AS campaign_name
      FROM meta_ad_insight WHERE campaign_name IS NOT NULL ${inAccount}
      GROUP BY campaign_id
    )`;
}

// The joins `campaignIdSql` reads from. All are left joins: a touchpoint
// that resolves to no campaign at all is still a lead and still counted.
export function campaignJoinSql(sql: postgres.Sql, alias = "t") {
  return sql`
    LEFT JOIN ad_campaign ai ON ai.ad_id = ${sql(`${alias}.utm_ad_id`)}
    LEFT JOIN ad_campaign ac ON ac.ad_id = ${sql(`${alias}.utm_content`)}
    LEFT JOIN adset_campaign sc ON sc.adset_id = ${sql(`${alias}.utm_term`)}`;
}

export function campaignIdSql(sql: postgres.Sql, alias = "t") {
  return sql`coalesce(${sql(`${alias}.utm_campaign_id`)}, ai.campaign_id, ac.campaign_id, sc.campaign_id)`;
}

// A grouped row's display name. `alias` is the grouped CTE, which carries
// `campaign_id` and the lead's own `utm_campaign`; `campaign_name` must be
// joined as `cn`. The lead's own name is preferred unless it is the id
// retyped as a name, and Meta's name fills in where the lead carried none.
//
// The row with no campaign id gets no name. It pools every lead whose
// campaign could not be resolved — 403 touchpoints under 31 different names
// on 2 Nov — and borrowing one of those names would present the catch-all as
// one real campaign. The screen labels a nameless row as missing.
export function campaignNameSql(sql: postgres.Sql, alias: string) {
  const id = sql(`${alias}.campaign_id`);
  const name = sql(`${alias}.utm_campaign`);
  return sql`CASE WHEN ${id} IS NULL THEN NULL ELSE coalesce(
               max(${name}) FILTER (WHERE ${name} !~ '^[0-9]+$'),
               max(cn.campaign_name),
               max(${name})
             ) END`;
}

// §9.18 first touch. `touchpoint.is_first_touch` is held to one row per
// person by an index, and `ghl:import` had already claimed it for each
// imported person's bare import row, so every attribution row carrying a UTM
// went in false — all 3,242 of them. Touchpoints are append-only, so the flag
// cannot be moved after the fact. The attribution import marks the real first
// instead with an `external_ref` of `ghl-attr:first:<contact>`, one per
// person. Either mark counts as a first touch; without the second one the
// column reads 0 on every row and leads equals later touch everywhere.
//
// Coalesced to false because `external_ref` is nullable: `false OR NULL` is
// NULL, which neither `FILTER (WHERE first_touch)` nor `FILTER (WHERE NOT
// first_touch)` counts, and which sorts ahead of true under `DESC`. No UTM
// row has a NULL ref today; the first web-form lead would.
//
// Known gap: a person with a flagged lead-form row and a SalesProcess first
// mark would count two first touches. Nobody does on 2 Nov — lead-form
// intake does not exist yet — so it is left until there is a row to test.
export function firstTouchSql(sql: postgres.Sql, alias = "t") {
  return sql`coalesce(${sql(`${alias}.is_first_touch`)}
              OR ${sql(`${alias}.external_ref`)} LIKE 'ghl-attr:first:%', false)`;
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

  // Grouped on the campaign id — stored where the lead carried one, else
  // resolved from its ad or ad set (`campaignIdSql`) — so a row lines up with
  // `meta_ad_insight` and can be shown beside what that campaign cost. The
  // name is carried for the screen only: Meta cases it inconsistently and it
  // is retyped per run. Where a lead carried an id but no name — 21 rows do —
  // or carried the id again in place of the name, which older SalesProcess
  // rows do, the name comes from `meta_ad_insight`, so a row is never
  // labelled with a number or shown as a campaign we cannot name.
  //
  // Leads with no campaign id are one row, not dropped, so the rows still sum
  // to the total — and that row is the honest size of what cannot be
  // attributed. It carries no name (`campaignNameSql`).
  //
  // The windows run over every group, before LIMIT, so `total_leads` and
  // `group_count` describe the whole range rather than the page shown.
  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    meta AS (
      SELECT ${campaignIdSql(sql)} AS campaign_id,
             t.utm_campaign,
             ${firstTouchSql(sql)} AS first_touch,
             t.person_id
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      ${campaignJoinSql(sql)}
      WHERE ${metaTouchpointSql(sql)}
        AND ${rangeSql(sql, q)}
        AND ${livePersonSql(sql)}
    )
    SELECT m.campaign_id,
           ${campaignNameSql(sql, "m")} AS campaign,
           count(*)::int AS leads,
           count(*) FILTER (WHERE m.first_touch)::int AS first_touch,
           count(*) FILTER (WHERE NOT m.first_touch)::int AS later_touch,
           count(DISTINCT m.person_id)::int AS people,
           (count(*) OVER ())::int AS group_count,
           (sum(count(*)) OVER ())::int AS total_leads
    FROM meta m
    LEFT JOIN campaign_name cn ON cn.campaign_id = m.campaign_id
    GROUP BY m.campaign_id
    ORDER BY leads DESC, campaign_id ASC NULLS LAST
    LIMIT ${ROWS_SHOWN}`;

  return {
    rows: rows.map((r) => ({
      campaignId: r.campaign_id,
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
  // "First" is the row the attribution import marked first (`firstTouchSql`),
  // falling back to the earliest by `occurred_at` for a person it did not
  // mark. The id breaks a tie so the answer is stable between runs.
  //
  // The join is on the campaign id, not the campaign name. Names vary in
  // Meta's own data ("WhatsApp" against "Whatsapp") and are retyped per run;
  // the id is the thing Meta and the lead both carry, and where the lead did
  // not carry one it is resolved from its ad or ad set.
  // A synced seat has no deal, so the deal alone reports 0 HRDC however many
  // grant seats the LMS holds. The LMS ids top it up; an LMS that cannot be
  // reached leaves the deal-only count rather than failing the report.
  const lmsHrdcIds = await lmsHrdcEnrollmentIds().catch(() => [] as string[]);

  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    first_touch AS (
      SELECT DISTINCT ON (t.person_id)
             t.person_id, ${campaignIdSql(sql)} AS campaign_id, t.utm_campaign
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      ${campaignJoinSql(sql)}
      WHERE ${campaignIdSql(sql)} IS NOT NULL
        AND ${metaTouchpointSql(sql)}
        AND ${livePersonSql(sql)}
      ORDER BY t.person_id, ${firstTouchSql(sql)} DESC, t.occurred_at ASC, t.id ASC
    )
    SELECT f.campaign_id AS campaign_id,
           ${campaignNameSql(sql, "f")} AS campaign,
           count(*)::int AS signups,
           count(*) FILTER (
             WHERE d.funding_type = 'hrdc' OR e.id = ANY(${lmsHrdcIds}::uuid[])
           )::int AS hrdc_signups
    FROM first_touch f
    LEFT JOIN campaign_name cn ON cn.campaign_id = f.campaign_id
    JOIN enrolment e ON e.person_id = f.person_id
    JOIN class cl ON cl.id = e.class_id
    JOIN course co ON co.id = cl.course_id
    LEFT JOIN deal d ON d.id = e.deal_id
    WHERE ${seatTakenSql(sql)}
      ${sizeSql(sql, q)}
      AND e.created_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
      AND e.created_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    GROUP BY f.campaign_id
    ORDER BY signups DESC, campaign_id ASC
    LIMIT ${ROWS_SHOWN}`;

  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaign: r.campaign,
    signups: r.signups,
    hrdcSignups: r.hrdc_signups,
  }));
}
