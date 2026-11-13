import {
  canReviewFlagged,
  canWriteClass,
  PermissionError,
  permissionFor,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { classWhenSql, seatTakenSql } from "../classes/seats.ts";
import {
  campaignIdSql,
  campaignJoinSql,
  campaignMapSql,
  livePersonSql,
} from "../reports/ads.ts";
import { listDeals } from "../deals/service.ts";
import { PIPELINES, type Pipeline, type Stage } from "../deals/types.ts";
import { sumMyr } from "../format/money.ts";
import { db, withTransaction } from "../sql.ts";
import { dealListQuerySchema } from "../validation/deal.ts";
import type {
  HomeClass,
  HomeNeedsAttention,
  HomePipelineTotals,
  HomeTask,
  HomeTasks,
} from "./types.ts";

// Service layer for the §9.0 Home work page. Four independent reads, each
// permission-checked on its own so the page can render the panels a role
// may see and skip the rest. Nothing here writes.

// Spec §4: a Kuala Lumpur day, not the server's. "Before the end of today
// in KL" is exactly overdue plus due-today, so the task panel needs one
// predicate and one ORDER BY rather than two queries (design decision 3).
const TASKS_SHOWN = 10;

export async function myTasks(viewer: Viewer): Promise<HomeTasks> {
  requirePermission(viewer, "task", "read");
  const sql = db();

  // LIMIT 11 for a ten-row panel: row eleven is how the panel knows to say
  // "more on the Tasks screen" without paying for a second count query.
  const rows = await sql`
    SELECT t.id, t.type, t.title, t.due_at,
           (t.due_at < now()) AS is_overdue,
           t.person_id, t.deal_id,
           coalesce(p.full_name, dp.full_name) AS person_name
    FROM task t
    LEFT JOIN person p ON p.id = t.person_id
    LEFT JOIN deal d ON d.id = t.deal_id
    LEFT JOIN person dp ON dp.id = d.person_id
    WHERE t.done_at IS NULL
      AND t.assigned_user_id = ${viewer.id}
      AND t.due_at IS NOT NULL
      AND t.due_at < ((date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
                       + interval '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur')
    ORDER BY t.due_at, t.id
    LIMIT ${TASKS_SHOWN + 1}`;

  return summariseTasks(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      // ponytail: the person's current employer would need a second join
      // per row; the name alone is enough to recognise the task. Add the
      // company when 9.14 needs it.
      who: r.person_name ?? null,
      href: r.person_id
        ? `/people/${r.person_id}`
        : r.deal_id
          ? `/deals/${r.deal_id}`
          : null,
      dueAt: new Date(r.due_at).toISOString(),
      isOverdue: r.is_overdue,
    })),
  );
}

// Splits the eleven read rows into the ten shown and the count of what is
// left (§9.0 panel). Pure, so the cap and the counts are testable without
// a database.
export function summariseTasks(rows: HomeTask[]): HomeTasks {
  return {
    // ponytail: the counts cover the eleven rows read, so a user with
    // thirty overdue tasks sees "11" beside "10 more". Exact counts would
    // cost a second query for a number nobody acts on.
    tasks: rows.slice(0, TASKS_SHOWN),
    moreCount: Math.max(0, rows.length - TASKS_SHOWN),
    overdueCount: rows.filter((r) => r.isOverdue).length,
    todayCount: rows.filter((r) => !r.isOverdue).length,
  };
}

// Won and lost are not open work, so they are dropped from the panel and
// from its pipeline total (§9.0).
const CLOSED_STAGES: readonly string[] = ["won", "lost"];

// One call per pipeline: §9.5 treats individual and corporate as separate
// pipelines with different stages, and `stageTotals` is already shaped that
// way. `limit: 1` because only the totals are wanted — the board's filter
// rules stay in listDeals() rather than being copied here (design 4).
export async function myOpenDeals(
  viewer: Viewer,
): Promise<HomePipelineTotals[]> {
  requirePermission(viewer, "deal", "read");

  return Promise.all(
    PIPELINES.map(async (pipeline: Pipeline) => {
      const { stageTotals } = await listDeals(
        dealListQuerySchema.parse({ pipeline, mine: "true", limit: "1" }),
        viewer,
      );
      return openStageTotals(pipeline, stageTotals);
    }),
  );
}

// Drops the closed stages and totals what is left. The per-stage values
// were summed by the database; adding them up here stays in whole cents
// (§4, §12.7). Pure, so the stage set and the totals are testable without
// a database.
export function openStageTotals(
  pipeline: Pipeline,
  stageTotals: readonly { stage: string; count: number; totalMyr: string }[],
): HomePipelineTotals {
  const stages = stageTotals
    .filter((t) => !CLOSED_STAGES.includes(t.stage))
    .map((t) => ({
      stage: t.stage as Stage,
      count: t.count,
      totalMyr: t.totalMyr,
    }));
  return {
    pipeline,
    stages,
    openCount: stages.reduce((n, t) => n + t.count, 0),
    openTotalMyr: sumMyr(stages.map((t) => t.totalMyr)),
  };
}

// Spec §9.0: the next 14 days in Kuala Lumpur days (§4), cancelled classes
// excluded, seats taken per §12.1.
export async function upcomingClasses(viewer: Viewer): Promise<HomeClass[]> {
  requirePermission(viewer, "class", "read");
  const sql = db();

  const rows = await sql`
    SELECT c.id, c.code, c.language, c.mode,
           to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
           c.venue_name, c.city, c.status, c.capacity,
           co.name_en AS course_name,
           (SELECT count(*)::int FROM enrolment e
             WHERE e.class_id = c.id AND ${seatTakenSql(sql)}) AS sold
    FROM class c
    JOIN course co ON co.id = c.course_id
    WHERE c.status <> 'cancelled'
      AND c.start_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
      AND c.start_date <= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 14
    ORDER BY c.start_date, c.code`;

  const optins = canSeeLeadCounts(viewer)
    ? await optinsOrNull(() =>
        // A savepoint inside an open transaction, so a failed read doesn't
        // abort the caller's work.
        withTransaction(() => classOptins(rows.map((r) => r.id as string))),
      )
    : null;

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    courseName: r.course_name,
    startDate: r.start_date,
    endDate: r.end_date,
    language: r.language,
    mode: r.mode,
    venue: r.venue_name,
    city: r.city,
    status: r.status,
    capacity: r.capacity,
    sold: r.sold,
    optins: optins
      ? (optins.get(r.id) ?? { linkedCampaigns: 0, people: 0 })
      : null,
  }));
}

// Opt-ins are an extra on the class cards (review, 12 Nov): when their read
// fails (a timeout, a database without migration 023) the cards still load,
// without the number, and the reason is logged rather than swallowed (§13).
export async function optinsOrNull<T>(
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error("[home] class opt-ins failed", err);
    return null;
  }
}

// Opt-ins and sign-ups are totals over everyone's leads, so they follow the
// ads report's rule (requireReportReader): person read without the
// assigned-only limit. Other roles get the classes without the number.
export function canSeeLeadCounts(viewer: Viewer): boolean {
  const read = permissionFor(viewer, "person", "read");
  return read.allowed && !read.assignedOnly;
}

// Per class: how many Meta campaigns are linked (migration 023) and how many
// live people opted in on WhatsApp through any of them (their first chat
// came from it), all time. The ad's
// campaign is resolved the way the ads report does it, so a card and the
// report agree on which campaign a chat came from.
async function classOptins(
  classIds: string[],
): Promise<Map<string, { linkedCampaigns: number; people: number }>> {
  if (classIds.length === 0) return new Map();
  const sql = db();
  const rows = await sql`
    WITH ${campaignMapSql(sql)},
    links AS (
      SELECT class_id, meta_campaign_id FROM class_meta_campaign
      WHERE class_id = ANY(${classIds}::uuid[])
    ),
    -- Each person's first WhatsApp chat only, the ads report's Opt-ins rule
    -- (whatsappOptinRows): a contact who first chatted from another
    -- campaign is a returning chat there, not an opt-in here.
    ctwa AS (
      SELECT DISTINCT ON (t.person_id) t.person_id,
             ${campaignIdSql(sql)} AS campaign_id
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      ${campaignJoinSql(sql)}
      WHERE t.channel = 'ctwa' AND ${livePersonSql(sql)}
      ORDER BY t.person_id, t.occurred_at, t.id
    )
    SELECT l.class_id,
           count(DISTINCT l.meta_campaign_id)::int AS linked,
           count(DISTINCT c.person_id)::int AS people
    FROM links l
    LEFT JOIN ctwa c ON c.campaign_id = l.meta_campaign_id
    GROUP BY l.class_id`;
  return new Map(
    rows.map((r) => [
      r.class_id as string,
      { linkedCampaigns: r.linked as number, people: r.people as number },
    ]),
  );
}

// Spec §9.0 needs attention: one count per item, each gated on its own
// permission, because no single role can act on all of them. The unmatched
// payment count still waits on Shawn's Stripe webhook (§11.3).
export async function needsAttention(
  viewer: Viewer,
): Promise<HomeNeedsAttention> {
  // Flagged people are for the roles that may edit a person (§6 person write).
  // A part-timer's "A" covers their own records, so a queue of everyone
  // else's possible duplicates is not theirs to work through.
  const mayReviewPeople = canReviewFlagged(viewer);
  // Notices are approved by super_admin and operations only (§7.1, §9.10).
  const mayApproveNotices = canWriteClass(viewer);
  // Nothing this role can act on is a forbidden panel, not an empty one (§6).
  if (!mayReviewPeople && !mayApproveNotices)
    throw new PermissionError("person");

  const sql = db();
  const [needsReview, pendingNotices] = await Promise.all([
    mayReviewPeople
      ? sql`SELECT count(*)::int AS n FROM person
            WHERE needs_review AND deleted_at IS NULL AND merged_into_id IS NULL`
      : null,
    mayApproveNotices
      ? // Counted over the classes the panel's link actually shows, so the
        // number and the page agree: it opens the §9.8 list filtered to
        // pending notices, and that list is upcoming by default (§9.8). A
        // stale notice left on a class that has already run is found with
        // `?when=past&filter[pendingNotice]=true`.
        sql`SELECT count(*)::int AS n
            FROM class_notice n JOIN class c ON c.id = n.class_id
            WHERE n.status = 'pending' AND ${classWhenSql(sql, "upcoming")}`
      : null,
  ]);

  return {
    needsReview: needsReview ? (needsReview[0].n as number) : null,
    pendingNotices: pendingNotices ? (pendingNotices[0].n as number) : null,
  };
}
