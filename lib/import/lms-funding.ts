// An LMS enrollment's funding_type -> the CRM seat's enrolment.funding_type
// (migration 023, 12 Nov 2026). Pure: no database. Used by scripts/sync-lms.ts.
// The CRM keeps the LMS's own values; Zixuan chose them over the deal's
// self/company/hrdc/other list, and who pays stays in payer_type.

export const FUNDING_TYPES = [
  "self_funded",
  "hrdc",
  "internal",
  "leaders_club",
  "refresher",
] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];

// A value outside the list would fail the enrolment_funding_type_check and
// with it the whole sync, so it becomes NULL and is named for a warning
// instead (Shawn's review of #71). The LMS's full list is still owed by its
// owner; a new value needs a migration that widens the CHECK.
export function lmsFundingType(value: unknown): {
  funding: FundingType | null;
  unknown: string | null;
} {
  if (value === null || value === undefined || value === "")
    return { funding: null, unknown: null };
  const v = String(value);
  return (FUNDING_TYPES as readonly string[]).includes(v)
    ? { funding: v as FundingType, unknown: null }
    : { funding: null, unknown: v };
}

// What the sync compares to decide a synced seat is unchanged. It must match
// the order of `SELECT id, price_paid_myr::float8, funding_type FROM enrolment`
// read back through existing() in sync-lms.ts (every column after the id).
export function seatSyncKey(
  pricePaidMyr: number,
  funding: FundingType | null,
): string {
  return JSON.stringify([pricePaidMyr, funding]);
}
