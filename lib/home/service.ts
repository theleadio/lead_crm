import {
  PermissionError,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { seatTakenSql } from "../classes/seats.ts";
import { listDeals } from "../deals/service.ts";
import { PIPELINES, type Pipeline, type Stage } from "../deals/types.ts";
import { sumMyr } from "../format/money.ts";
import { db } from "../sql.ts";
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
  }));
}

// Spec §9.0 needs attention. Only the `needs_review` queue for now: the
// unmatched-payment and pending-notice counts wait on Shawn's Stripe
// webhook (§11.3) and the 9.9/9.10 notice flow.
export async function needsAttention(
  viewer: Viewer,
): Promise<HomeNeedsAttention> {
  // Shown only to roles that can act on a flagged person (§6 person write).
  // A part-timer's "A" covers their own records, so a queue of everyone
  // else's possible duplicates is not theirs to work through.
  const { assignedOnly } = requirePermission(viewer, "person", "write");
  if (assignedOnly) throw new PermissionError("person");
  const sql = db();

  const [row] = await sql`
    SELECT count(*)::int AS needs_review FROM person
    WHERE needs_review AND deleted_at IS NULL AND merged_into_id IS NULL`;

  return { needsReview: row.needs_review };
}
