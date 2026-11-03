import { db, withTransaction } from "../sql.ts";
import { websiteBase } from "./links.ts";
import {
  scheduleQuerySchema,
  type ScheduleQuery,
} from "../validation/public.ts";
import type { z } from "zod";
import type { Env } from "./guard.ts";

// Spec §8.1. The website feed. The select list below is the whole allow-list
// of what leaves the building: no online_url, no trainer_user_ids, no notes,
// no capacity or seat counts, and no row ids other than the class id.

const SEATS_LABEL = {
  open: "available",
  few_seats: "few_seats",
  full: "full",
} as const;

export type ScheduleClass = {
  id: string;
  code: string;
  // The name in the class's own language (kept for older callers), and both
  // names so a page can show its own language's name (§10.5, v1.24). The
  // Chinese name is null when the course has none.
  courseName: string;
  courseNameEn: string;
  courseNameZh: string | null;
  track: string;
  language: string;
  startDate: string;
  endDate: string;
  // null when the class has no time yet: §5 makes both optional.
  startTime: string | null;
  endTime: string | null;
  mode: string;
  venueName: string | null;
  city: string | null;
  priceMyr: string | null;
  hrdcClaimable: boolean;
  seatsLabel: "available" | "few_seats" | "full";
  registerUrl: string | null;
};

export async function listPublicSchedule(
  q: ScheduleQuery,
  websiteUrl: string | null,
): Promise<{ generatedAt: string; classes: ScheduleClass[] }> {
  const sql = db();
  // "Today" is the Malaysian date (§4): a class starting today stays listed
  // until midnight in Kuala Lumpur, whatever the server's clock zone is.
  const rows = await sql`
    SELECT cl.id, cl.code, cl.status, cl.language, cl.mode, cl.city,
           cl.start_date::text AS start_date, cl.end_date::text AS end_date,
           to_char(cl.start_time, 'HH24:MI') AS start_time,
           to_char(cl.end_time, 'HH24:MI') AS end_time,
           CASE WHEN cl.mode = 'online' THEN NULL ELSE cl.venue_name END AS venue_name,
           CASE WHEN cl.language = 'zh' THEN coalesce(c.name_zh, c.name_en)
                ELSE c.name_en END AS course_name,
           c.name_en AS course_name_en, c.name_zh AS course_name_zh,
           c.track,
           coalesce(cl.price_myr, c.list_price_myr)::text AS price_myr,
           cl.hrdc_claimable
    FROM class cl
    JOIN course c ON c.id = cl.course_id
    WHERE cl.is_public
      AND cl.status IN ('open', 'few_seats', 'full')
      AND cl.start_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
      ${q.language ? sql`AND cl.language = ${q.language}` : sql``}
      ${q.track ? sql`AND c.track = ${q.track}` : sql``}
      ${q.city ? sql`AND lower(cl.city) = lower(${q.city})` : sql``}
    ORDER BY cl.start_date, cl.start_time, cl.code
    LIMIT ${q.limit}`;

  return {
    generatedAt: new Date().toISOString(),
    classes: rows.map((r) => ({
      id: r.id,
      code: r.code,
      courseName: r.course_name,
      courseNameEn: r.course_name_en,
      courseNameZh: r.course_name_zh,
      track: r.track,
      language: r.language,
      startDate: r.start_date,
      endDate: r.end_date,
      startTime: r.start_time,
      endTime: r.end_time,
      mode: r.mode,
      venueName: r.venue_name,
      city: r.mode === "online" ? null : r.city,
      priceMyr: r.price_myr,
      hrdcClaimable: r.hrdc_claimable,
      seatsLabel: SEATS_LABEL[r.status as keyof typeof SEATS_LABEL],
      registerUrl: websiteUrl
        ? `${websiteUrl}/register/${encodeURIComponent(r.code)}`
        : null,
    })),
  };
}

// Runs fn in a transaction whose statements are cut off after ms milliseconds
// (transaction-local, so it never touches the shared pool or the job scripts
// that use lib/sql.ts). A hung database then fails the call with SQLSTATE
// 57014 instead of hanging the page. Called inside an open transaction it
// joins it and puts the previous value back afterwards.
export async function withStatementTimeout<T>(
  ms: number,
  fn: () => Promise<T>,
): Promise<T> {
  return withTransaction(async () => {
    const sql = db();
    const [{ statement_timeout: before }] = await sql`SHOW statement_timeout`;
    await sql`SELECT set_config('statement_timeout', ${String(Math.trunc(ms))}, true)`;
    const result = await fn();
    await sql`SELECT set_config('statement_timeout', ${before}, true)`;
    return result;
  });
}

export const READ_SCHEDULE_TIMEOUT_MS = 5000;

// The feed as a function, for server code in this app (the §10.1 schedule
// page). Same allow-list and rules as GET /api/public/schedule, with no HTTP
// hop, no API key, no CORS and no CDN layer: the caller is our own server.
// A bad filter is a type error here and throws at run time, like the route's
// 400; the query is cut off after 5 seconds. Not for browsers.
// Pass limit explicitly: it defaults to 50, and 100 is the cap (§14).
export async function readSchedule(
  env: Env,
  query: z.input<typeof scheduleQuerySchema> = {},
) {
  const q = scheduleQuerySchema.parse(query);
  return withStatementTimeout(READ_SCHEDULE_TIMEOUT_MS, () =>
    listPublicSchedule(q, websiteBase(env)),
  );
}
