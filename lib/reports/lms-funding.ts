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
import { lmsFundingByCourse } from "../lms/read.ts";
import type { FundingRow } from "./funding.ts";

// The LMS writes `cn`; the CRM's class language is `zh` (§4). One name for
// one thing, so the panel and the rest of the app agree.
function crmLanguage(language: string | null): "en" | "zh" {
  return language === "cn" || language === "zh" ? "zh" : "en";
}

export async function fundingFromLms(viewer: Viewer): Promise<FundingRow[]> {
  requireReportReader(viewer);
  const rows = await lmsFundingByCourse();
  return rows.map((row) => ({
    course: row.courseName,
    language: crmLanguage(row.language),
    durationDays: row.durationDays,
    // The LMS has no price either: courses.price_cents is 0 and
    // cohorts.price_cents is null on every row, so there is nothing to show
    // and nothing is invented.
    listPriceMyr: null,
    hrdc: row.hrdc,
    notHrdc: row.seats - row.hrdc,
  }));
}
