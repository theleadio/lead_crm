// Classes are managed in the LMS (Shawn, 23 Nov 2026). The nightly LMS sync
// (scripts/sync-lms.ts) writes start date, end date and language on every
// class linked to an LMS cohort, and the code too on a class the LMS made
// (its id is the cohort id). The CRM reads the LMS and never writes to it, so
// a CRM edit to one of these fields was quietly undone the next night, after
// any notice about it had already gone out. These fields are therefore
// read-only in the CRM on a linked class; change them in the LMS.

export type LmsLockedField = "code" | "startDate" | "endDate" | "language";

export type LmsLinkRow = { id: string; lms_cohort_id: string | null };

// The fields the sync owns on this class; empty for a class the LMS doesn't know.
export function lmsLockedFields(row: LmsLinkRow): LmsLockedField[] {
  if (!row.lms_cohort_id) return [];
  // A class the CRM made and the sync adopted keeps its own code: lead_sales
  // pages and /register find a class by it (review of #89).
  return row.lms_cohort_id === row.id
    ? ["code", "startDate", "endDate", "language"]
    : ["startDate", "endDate", "language"];
}

const asText = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();

// Locked fields the patch would change. Sending a locked field back with the
// value it already has is fine: the edit form posts every field.
export function lmsLockedChanges(
  locked: LmsLockedField[],
  patch: Partial<Record<LmsLockedField, unknown>>,
  before: Record<LmsLockedField, unknown>,
): LmsLockedField[] {
  return locked.filter(
    (f) => patch[f] !== undefined && asText(patch[f]) !== asText(before[f]),
  );
}

export const LMS_LOCKED_LABELS: Record<LmsLockedField, string> = {
  code: "class code",
  startDate: "start date",
  endDate: "end date",
  language: "language",
};
