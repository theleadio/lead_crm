import {
  PermissionError,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { seatTakenSql } from "../classes/seats.ts";
import { db } from "../sql.ts";
import type { AdsReportQuery } from "../validation/report.ts";

// The two §9.18 panels that can be drawn from tables that already exist: who
// pays, and course price against HRDC share. Both count seat-holding
// enrolments (§12.1) through `seatTakenSql`, so this screen can never report a
// seat the §9.8 class screen would refuse.

const ROWS_SHOWN = 100;

// §12.6: the HRDC signal is the deal's funding type — the intent recorded at
// the sale. A grant seat is not paid through Stripe, which is exactly why a
// programme with many of them looks worse on revenue than it is.
// An enrolment with no deal has no recorded funding, so it is counted as "not
// HRDC" rather than guessed into either side; the panel says so.
function hrdcSql(sql: ReturnType<typeof db>) {
  return sql`(d.funding_type = 'hrdc')`;
}

export type FundingRow = {
  course: string;
  language: "en" | "zh";
  durationDays: number;
  listPriceMyr: string | null;
  hrdc: number;
  notHrdc: number;
};

export type PriceShareRow = {
  course: string;
  listPriceMyr: string;
  hrdcShare: number;
  seats: number;
};

function requireReportReader(viewer: Viewer): void {
  const { assignedOnly } = requirePermission(viewer, "person", "read");
  if (assignedOnly) throw new PermissionError("person");
}

// Enrolments are ranged on when they were created, in Kuala Lumpur days (§4),
// the same half-open range the campaign tables use.
function rangeSql(sql: ReturnType<typeof db>, q: AdsReportQuery) {
  return sql`e.created_at >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
         AND e.created_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`;
}

// Who pays, per course and class language. The price tier the reference
// dashboard splits on is `course.duration_days`, which is a property of the
// course rather than a third grouping dimension.
export async function fundingSplit(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<FundingRow[]> {
  requireReportReader(viewer);
  const sql = db();

  const rows = await sql`
    SELECT co.name_en AS course,
           c.language,
           co.duration_days,
           co.list_price_myr,
           count(*) FILTER (WHERE ${hrdcSql(sql)})::int AS hrdc,
           count(*) FILTER (WHERE NOT coalesce(${hrdcSql(sql)}, false))::int
             AS not_hrdc
    FROM enrolment e
    JOIN class c ON c.id = e.class_id
    JOIN course co ON co.id = c.course_id
    JOIN person p ON p.id = e.person_id
    LEFT JOIN deal d ON d.id = e.deal_id
    WHERE ${seatTakenSql(sql)}
      AND ${rangeSql(sql, q)}
      AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
    GROUP BY co.name_en, c.language, co.duration_days, co.list_price_myr
    ORDER BY count(*) DESC, co.name_en ASC, c.language ASC
    LIMIT ${ROWS_SHOWN}`;

  return rows.map((r) => ({
    course: r.course,
    language: r.language,
    durationDays: r.duration_days,
    listPriceMyr: r.list_price_myr,
    hrdc: r.hrdc,
    notHrdc: r.not_hrdc,
  }));
}

// Course price against the share of its seats that HRDC funded. A course with
// no seats in range is absent rather than a divide by zero, and a course with
// no list price cannot be placed on the price axis at all.
export async function priceAgainstHrdcShare(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<PriceShareRow[]> {
  requireReportReader(viewer);
  const sql = db();

  const rows = await sql`
    SELECT co.name_en AS course,
           co.list_price_myr,
           count(*)::int AS seats,
           count(*) FILTER (WHERE ${hrdcSql(sql)})::int AS hrdc
    FROM enrolment e
    JOIN class c ON c.id = e.class_id
    JOIN course co ON co.id = c.course_id
    JOIN person p ON p.id = e.person_id
    LEFT JOIN deal d ON d.id = e.deal_id
    WHERE ${seatTakenSql(sql)}
      AND ${rangeSql(sql, q)}
      AND co.list_price_myr IS NOT NULL
      AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
    GROUP BY co.name_en, co.list_price_myr
    ORDER BY co.list_price_myr ASC, co.name_en ASC
    LIMIT ${ROWS_SHOWN}`;

  return rows.map((r) => ({
    course: r.course,
    listPriceMyr: r.list_price_myr,
    hrdcShare: hrdcShare(r.hrdc, r.seats),
    seats: r.seats,
  }));
}

// Pure, so the arithmetic is testable without a database. Zero seats would be
// a divide by zero; the query cannot return such a row, and this returns 0
// rather than NaN if one ever arrives.
export function hrdcShare(hrdc: number, seats: number): number {
  return seats > 0 ? hrdc / seats : 0;
}

// The reference dashboard's one-day against two-day tiers.
export function priceTier(durationDays: number): string {
  return durationDays === 1 ? "1 day" : `${durationDays} days`;
}

// --- the who-pays breakdowns ------------------------------------------------
// The same seats cut three ways: every seat, by how long the programme runs,
// and by the language it was taught in. Each cut sums to the same total, so a
// reader can check one against another.
//
// The reference dashboard cuts the middle one by price (RM 734 classes, RM
// 3,456 certifications). Price is NULL on every course in both databases, so
// this cuts by length instead — which is what the price tiers stand for — and
// says so rather than printing a price nobody recorded.

export type FundingSlice = {
  key: string;
  label: string;
  note: string;
  hrdc: number;
  notHrdc: number;
};

export type FundingBreakdowns = {
  all: FundingSlice;
  byTier: FundingSlice[];
  byLanguage: FundingSlice[];
};

const LANGUAGE_NAME: Record<string, string> = { en: "EN", zh: "CN" };

function fold(
  key: string,
  label: string,
  note: string,
  rows: FundingRow[],
): FundingSlice {
  return {
    key,
    label,
    note,
    hrdc: rows.reduce((n, r) => n + r.hrdc, 0),
    notHrdc: rows.reduce((n, r) => n + r.notHrdc, 0),
  };
}

function groupBy<T>(rows: FundingRow[], of: (row: FundingRow) => T) {
  const out = new Map<T, FundingRow[]>();
  for (const row of rows) {
    const list = out.get(of(row)) ?? [];
    list.push(row);
    out.set(of(row), list);
  }
  return out;
}

export function fundingBreakdowns(rows: FundingRow[]): FundingBreakdowns {
  const seats = rows.reduce((n, r) => n + r.hrdc + r.notHrdc, 0);
  const programmes = new Set(rows.map((r) => r.course)).size;

  const byTier = [...groupBy(rows, (r) => r.durationDays)]
    .sort(([a], [b]) => a - b)
    .map(([days, list]) =>
      fold(
        `tier-${days}`,
        priceTier(days),
        `${days === 1 ? "one-day" : `${days}-day`} programmes`,
        list,
      ),
    );

  const byLanguage = [...groupBy(rows, (r) => r.language)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, list]) =>
      fold(
        `lang-${language}`,
        LANGUAGE_NAME[language] ?? language,
        "programmes",
        list,
      ),
    );

  return {
    all: fold(
      "all",
      String(seats),
      `seats, ${programmes} ${programmes === 1 ? "programme" : "programmes"}`,
      rows,
    ),
    byTier,
    byLanguage,
  };
}
