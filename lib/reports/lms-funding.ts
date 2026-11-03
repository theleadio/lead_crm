// The who-pays panel, sourced from the LMS while the CRM import does not
// carry funding across.
//
// `deal.funding_type` is where funding belongs, and the panel reads it from
// there as soon as a deal says anything (§9.18, lib/reports/funding.ts). Today
// `deal` is empty, so every seat would read as not-HRDC — wrong rather than
// missing. The LMS has it on all of them, so this reads it there and the
// panel says which source it used.
//
// HRDC is `funding_type = 'hrdc'`. The LMS also records `self_funded`,
// `internal`, `leaders_club` and `refresher`; none of those is a grant, so
// they count as not-HRDC rather than being folded into a guess.

import { requireReportReader } from "./ads.ts";
import type { Viewer } from "../auth/permissions.ts";
import type { AdsReportQuery } from "../validation/report.ts";
import { lmsFundingByCourse } from "../lms/read.ts";
import { db } from "../sql.ts";
import { matchesSize } from "./class-size.ts";
import type { FundingRow } from "./funding.ts";

// The LMS writes `cn`; the CRM's class language is `zh` (§4). One name for
// one thing, so the panel and the rest of the app agree.
function crmLanguage(language: string | null): "en" | "zh" {
  return language === "cn" || language === "zh" ? "zh" : "en";
}

// Prices are the CRM's: `course.list_price_myr`, typed in through the 9.7
// screen. The CRM courses were created by the LMS sync, so `name_en` is the
// LMS course name and that is the join — a course the CRM has no price for
// stays blank rather than being matched on something looser.
async function crmListPrices(): Promise<Map<string, string>> {
  const rows = await db()`
    SELECT name_en, list_price_myr FROM course
    WHERE list_price_myr IS NOT NULL`;
  return new Map(
    rows.map((r) => [r.name_en as string, r.list_price_myr as string]),
  );
}

export async function fundingFromLms(
  viewer: Viewer,
  q: AdsReportQuery,
): Promise<FundingRow[]> {
  requireReportReader(viewer);
  const [rows, prices] = await Promise.all([
    lmsFundingByCourse(q.from, q.to),
    crmListPrices(),
  ]);
  // The size filter is applied here, after the price join, because the price
  // is what decides the size. A course nobody has priced has no size, so a
  // filtered view leaves it out rather than guessing which band it is in.
  return rows
    .filter((row) => matchesSize(prices.get(row.courseName) ?? null, q.size))
    .map((row) => ({
      course: row.courseName,
      language: crmLanguage(row.language),
      durationDays: row.durationDays,
      // The LMS still has no price — courses.price_cents is 0 and
      // cohorts.price_cents is null on every row — so the figure comes from the
      // CRM. It is the self-funded list price before 8% SST; the HRDC and
      // with-coaching tiers have no column yet.
      listPriceMyr: prices.get(row.courseName) ?? null,
      hrdc: row.hrdc,
      notHrdc: row.seats - row.hrdc,
    }));
}
