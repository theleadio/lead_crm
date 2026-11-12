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
  type CampaignPaid,
  type CampaignSignups,
  type WhatsappOptinRow,
} from "./types.ts";

// Service layer for the §9.18 ads report. Independent reads over
// `touchpoint`, each permission-checked on its own, none of them writing.
// `meta_ad_insight` (migration 014) is read only to resolve a lead's campaign
// id from its ad or ad set; spend itself is summed in lib/reports/spend.ts.

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
  // Hand-typed in some ads' URL tags; 4 of 313 such leads carry no fbclid.
  "fb_ad",
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

// `utm_source` is free text: some ads were tagged "facebook" or "fb_ad" by
// hand, others take Meta's {{site_source_name}} macro (fb, ig, an, msg, th).
// All name a Meta placement, so they fold into the platform; any other value
// is shown as typed, and NULL stays NULL.
function platformSql(sql: postgres.Sql, alias = "t") {
  const source = sql`lower(btrim(${sql(`${alias}.utm_source`)}))`;
  return sql`CASE
    WHEN ${source} IN ('facebook', 'fb', 'fb_ad') THEN 'Facebook'
    WHEN ${source} IN ('instagram', 'ig') THEN 'Instagram'
    WHEN ${source} = 'an' THEN 'Audience Network'
    WHEN ${source} = 'msg' THEN 'Messenger'
    WHEN ${source} = 'th' THEN 'Threads'
    WHEN ${source} = 'meta' THEN 'Meta'
    ELSE ${sql(`${alias}.utm_source`)}
  END`;
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
      SELECT ${platformSql(sql)} AS utm_source,
             t.channel
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
           -- Faceted by platform: every SalesProcess row has channel
           -- 'import', so a channel facet was one chart. Lead Ads and
           -- click-to-WhatsApp rows carry no source and keep their channel.
           coalesce(${platformSql(sql)}, t.channel) AS channel,
           count(*)::int AS leads
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE ${metaTouchpointSql(sql)}
      AND ${rangeSql(sql, q)}
      AND ${livePersonSql(sql)}
    GROUP BY week_start, 2
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

// How many of a Monday-start week's seven days the report range covers, so
// a week the range cuts short can say so: three days of leads beside a full
// week reads as a drop that never happened (browser check, 11 Nov). Dates
// are YYYY-MM-DD Kuala Lumpur days, compared as UTC midnights.
export function daysInRange(
  weekStart: string,
  from: string,
  to: string,
): number {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const start = Math.max(day(weekStart), day(from));
  const end = Math.min(day(weekStart) + 6, day(to));
  return Math.max(0, end - start + 1);
}

// §9.18 efficiency map, the half that needs no ad tables: seat-holding
// enrolments (§12.1) credited to the campaign of the buyer's first touch.
//
// First touch per person, not per deal: O30 means a deal does not record the
// touchpoint that created it, so this is the honest model available, and the
// panel states it. A person who bought twice credits one campaign twice.
// The `first_touch` CTE: each live person's first Meta touchpoint that
// resolves to a campaign, one row per person. Needs `campaignMapSql` earlier
// in the same WITH. Shared by signups and revenue, so both panels credit the
// same campaign for the same buyer.
function firstCampaignSql(sql: postgres.Sql) {
  return sql`
    first_touch AS (
      SELECT DISTINCT ON (t.person_id)
             t.person_id, ${campaignIdSql(sql)} AS campaign_id, t.utm_campaign,
             t.occurred_at
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      ${campaignJoinSql(sql)}
      WHERE ${campaignIdSql(sql)} IS NOT NULL
        AND ${metaTouchpointSql(sql)}
        AND ${livePersonSql(sql)}
      ORDER BY t.person_id, ${firstTouchSql(sql)} DESC, t.occurred_at ASC, t.id ASC
    )`;
}

// The payments ROAS counts, one row per payment with its buyer: SalesProcess
// payments plus CRM `payment` rows, net of refunds, paid in the range. Shared
// by `revenuePerCampaign` and `paidInRange`, so the panel's "of RM Y paid"
// is the same money its bars are cut from.
function paidSql(sql: postgres.Sql, q: AdsReportQuery) {
  return sql`
    paid AS (
      SELECT DISTINCT b.person_id, sp.id, coalesce(sp.order_id, sp.id) AS order_key,
             sp.paid_at, sp.amount_myr - sp.refunded_myr AS net
      FROM salesprocess_payment sp
      -- The bare import row only: it carries the contact id, uses the
      -- (channel, external_ref) index, and is one per person. A left join:
      -- a payment whose buyer was never imported still counts as paid in
      -- the range (its person is null, so no campaign is credited with it).
      LEFT JOIN touchpoint b ON b.channel = 'import'
                       AND b.external_ref = 'ghl:' || sp.ghl_contact_id
      WHERE sp.live_mode
        AND sp.status IN ('succeeded', 'partially_refunded')
        AND sp.currency = 'MYR'
        AND sp.paid_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND sp.paid_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
      UNION ALL
      -- CRM payments (Stripe webhook, manual): the sales that move off
      -- SalesProcess. The buyer is the enrolment's person, else the deal's;
      -- an unmatched payment has neither and drops out. One order per
      -- enrolment (else deal), so instalments count once.
      -- shortcut: no dedupe against salesprocess_payment; a sale is in one
      -- table or the other until someone imports old Stripe history into
      -- payment, then match on the Stripe payment intent.
      SELECT coalesce(e.person_id, d.person_id), pn.id::text,
             'crm:' || coalesce(pn.enrolment_id, pn.deal_id)::text,
             pn.paid_at, pn.net_myr
      FROM payment_net pn
      LEFT JOIN enrolment e ON e.id = pn.enrolment_id
      LEFT JOIN deal d ON d.id = pn.deal_id
      WHERE pn.status IN ('succeeded', 'partially_refunded')
        AND pn.paid_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND pn.paid_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    )`;
}

// §9.18 ROAS revenue: SalesProcess payments (migration 016, Shawn's PR #34)
// plus CRM `payment` rows, credited to the buyer's first campaign, the same
// model as signups.
//
// Revenue is `amount_myr - refunded_myr` on live, succeeded or partially
// refunded payments, ranged on `paid_at` in Kuala Lumpur days. A payment
// reaches its buyer through the bare import touchpoint
// (`external_ref = 'ghl:' || ghl_contact_id`), which follows merges.
//
// Not split by class size: a payment names a SalesProcess product, not a CRM
// course, so there is no price band to filter on.
export async function revenuePerCampaign(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<CampaignPaid[]> {
  requireReportReader(viewer);
  const sql = db();

  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    ${firstCampaignSql(sql)},
    ${paidSql(sql, q)}
    -- An ad cannot have sold what was paid before it was seen. An order
    -- paid in instalments counts once.
    SELECT f.campaign_id, sum(p.net)::text AS revenue,
           count(DISTINCT p.order_key)::int AS orders
    FROM paid p
    JOIN first_touch f ON f.person_id = p.person_id
                      AND f.occurred_at <= p.paid_at
    GROUP BY f.campaign_id`;

  return rows.map((r) => ({
    campaignId: r.campaign_id,
    revenue: r.revenue,
    orders: r.orders,
  }));
}

// Everything paid in the range, attributed or not, for the ROAS panel's note:
// the bars only cover buyers a Meta campaign first found, and only campaigns
// that also spent in the range, so their ratio alone undercounts what was
// paid (browser check, 11 Nov: RM12.7k of RM109.5k).
export async function paidInRange(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<string> {
  requireReportReader(viewer);
  const sql = db();
  const [row] = await sql`
    WITH ${paidSql(sql, q)}
    SELECT coalesce(sum(net), 0)::numeric(14, 2)::text AS total FROM paid`;
  return row.total;
}

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
  //
  // A signup is a seat-holding enrolment, or a paid SalesProcess order from a
  // buyer who holds no seat in the range (Shawn's PR #37): most courses are
  // sold through SalesProcess funnels and many buyers never reach the LMS, so
  // seats alone missed most of them. A buyer with a seat is counted by the
  // seat only, never twice; an order paid in instalments counts once, and
  // only if paid after the first touch, as revenue is. Orders carry no class,
  // so a class-size filter counts seats alone.
  //
  // A synced seat has no deal, so the deal alone reports 0 HRDC however many
  // grant seats the LMS holds. The LMS ids top it up; an LMS that cannot be
  // reached leaves the deal-only count rather than failing the report.
  const lmsHrdcIds = await lmsHrdcEnrollmentIds().catch(() => [] as string[]);

  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    ${firstCampaignSql(sql)},
    seats AS (
      SELECT f.campaign_id, f.utm_campaign, f.person_id,
             coalesce(d.funding_type = 'hrdc' OR e.id = ANY(${lmsHrdcIds}::uuid[]), false) AS hrdc
      FROM first_touch f
      JOIN enrolment e ON e.person_id = f.person_id
      JOIN class cl ON cl.id = e.class_id
      JOIN course co ON co.id = cl.course_id
      LEFT JOIN deal d ON d.id = e.deal_id
      WHERE ${seatTakenSql(sql)}
        ${sizeSql(sql, q)}
        AND e.created_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND e.created_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    ),
    orders AS (
      SELECT DISTINCT f.campaign_id, f.utm_campaign, f.person_id,
             coalesce(sp.order_id, sp.id) AS order_key, false AS hrdc
      FROM salesprocess_payment sp
      JOIN touchpoint b ON b.channel = 'import'
                       AND b.external_ref = 'ghl:' || sp.ghl_contact_id
      JOIN first_touch f ON f.person_id = b.person_id
                        AND f.occurred_at <= sp.paid_at
      WHERE ${q.size ? sql`false` : sql`true`}
        AND sp.live_mode
        AND sp.status IN ('succeeded', 'partially_refunded')
        AND sp.currency = 'MYR'
        AND sp.paid_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND sp.paid_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND f.person_id NOT IN (SELECT person_id FROM seats)
    ),
    signup AS (
      SELECT campaign_id, utm_campaign, hrdc FROM seats
      UNION ALL
      SELECT campaign_id, utm_campaign, hrdc FROM orders
    )
    SELECT s.campaign_id,
           ${campaignNameSql(sql, "s")} AS campaign,
           count(*)::int AS signups,
           count(*) FILTER (WHERE s.hrdc)::int AS hrdc_signups
    FROM signup s
    LEFT JOIN campaign_name cn ON cn.campaign_id = s.campaign_id
    GROUP BY s.campaign_id
    ORDER BY signups DESC, campaign_id ASC
    LIMIT ${ROWS_SHOWN}`;

  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaign: r.campaign,
    signups: r.signups,
    hrdcSignups: r.hrdc_signups,
  }));
}

// WhatsApp opt-ins per click-to-WhatsApp ad, from the `ctwa` touchpoints
// scripts/sync-wati-ctwa.ts writes. An opt-in is a person who messaged
// through that ad in range, counted once per ad: opt-ins = new + again
// (Zixuan, 11 Nov). New is their first CTWA touchpoint ever, with no earlier
// contact (a SalesProcess import row doesn't count as contact); again is
// everyone else, so the two always add up. A person who opted in and came
// back through the same ad is one opt-in, not two. The total is distinct
// people across every ad, not the rows added up, so a person on two ads is
// one (Shawn, 11 Nov).
// Ads that spent in range on conversations but won no opt-in are listed too,
// with zero, because an ad that costs and brings nobody is the finding.
export async function whatsappOptinRows(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<AdsTable<WhatsappOptinRow>> {
  requireReportReader(viewer);
  const sql = db();
  const from = sql`(${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`;
  const to = sql`((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`;

  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    ctwa AS (
      SELECT t.id, t.person_id, t.occurred_at, t.utm_ad_id AS ad_id,
             ${campaignIdSql(sql)} AS campaign_id,
             row_number() OVER (PARTITION BY t.person_id
                                ORDER BY t.occurred_at, t.id) AS nth
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      ${campaignJoinSql(sql)}
      WHERE t.channel = 'ctwa' AND ${livePersonSql(sql)}
    ),
    in_range AS (
      SELECT c.*,
             NOT EXISTS (SELECT 1 FROM touchpoint e
                         WHERE e.person_id = c.person_id
                           AND e.channel <> 'import'
                           AND e.occurred_at < c.occurred_at) AS fresh
      FROM ctwa c
      WHERE c.occurred_at >= ${from} AND c.occurred_at < ${to}
    ),
    -- One row per ad. Grouping on the campaign id too split an ad in two when
    -- its touches resolved to different campaigns (utm_campaign_id on some,
    -- the Meta map on others), and the join below then put its spend on both.
    -- nth = 1 is one row per person already, so a plain count is distinct.
    optins AS (
      SELECT ad_id, min(campaign_id) AS campaign_id,
             count(DISTINCT person_id)::int AS optins,
             count(*) FILTER (WHERE nth = 1 AND fresh)::int AS fresh
      FROM in_range
      GROUP BY ad_id
    ),
    spend AS (
      SELECT ad_id, min(campaign_id) AS campaign_id, max(ad_name) AS ad_name,
             sum(spend) AS spend, sum(messages)::int AS messages
      FROM meta_ad_insight
      WHERE day >= ${q.from}::date AND day <= ${q.to}::date AND currency = 'MYR'
      GROUP BY ad_id
    ),
    joined AS (
      -- Meta knows which campaign an ad is in: its spend in range, else its
      -- campaign on any day; the touchpoint's own id only as a last resort.
      SELECT coalesce(s.campaign_id, am.campaign_id, o.campaign_id)
               AS campaign_id,
             coalesce(o.ad_id, s.ad_id) AS ad_id, s.ad_name,
             coalesce(o.optins, 0) AS optins, coalesce(o.fresh, 0) AS fresh,
             coalesce(o.optins - o.fresh, 0) AS again, s.spend, s.messages
      FROM optins o
      FULL JOIN spend s ON s.ad_id = o.ad_id
      LEFT JOIN ad_campaign am ON am.ad_id = coalesce(o.ad_id, s.ad_id)
      WHERE o.ad_id IS NOT NULL OR o.optins IS NOT NULL OR s.messages > 0
    )
    SELECT j.*, cn.campaign_name AS campaign, j.spend::text AS spend_myr,
           (count(*) OVER ())::int AS group_count,
           (SELECT count(DISTINCT person_id) FROM in_range)::int AS total_people
    FROM joined j
    LEFT JOIN campaign_name cn ON cn.campaign_id = j.campaign_id
    ORDER BY j.optins DESC, j.spend DESC NULLS LAST, j.ad_id
    LIMIT ${ROWS_SHOWN}`;

  return {
    rows: rows.map((r) => ({
      campaignId: r.campaign_id,
      campaign: r.campaign,
      adId: r.ad_id,
      adName: r.ad_name,
      optins: r.optins,
      fresh: r.fresh,
      again: r.again,
      spendMyr: r.spend_myr,
      metaMessages: r.messages,
    })),
    total: rows[0]?.total_people ?? 0,
    dropped: Math.max(0, (rows[0]?.group_count ?? 0) - rows.length),
  };
}
