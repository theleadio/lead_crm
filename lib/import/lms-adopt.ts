import type { Sql, TransactionSql } from "postgres";
import { CANCELLABLE_STATUSES } from "../classes/seats.ts";
import { pickClass } from "./salesprocess-enrolments.ts";

export type Cohort = { id: string; slug: string; course_id: string; start_date: string; language: "en" | "zh" };
export type ImportClass = {
  id: string;
  code: string;
  course_id: string;
  start_date: string;
  language: "en" | "zh";
  status: string;
};

const INACTIVE = ["cancelled", "refunded", "transferred"];

// cohort → CRM class id: the class that saved this cohort's LMS id (029), else
// its own id if the CRM has it, else the CRM-made class it adopted on an
// earlier run (code = slug), else the one CRM-made class of that course and
// start date, else its own id (a new class). "importClasses" is every class the
// CRM made, by the SalesProcess import or by hand (Shawn, 17 Nov 2026).
export function classIdForCohort(
  cohort: Cohort,
  crmIds: Set<string>,
  importClasses: ImportClass[],
  cohorts: Cohort[],
  warnings: string[],
  linked: ReadonlyMap<string, string> = new Map(), // LMS cohort id → CRM class id
): string {
  const saved = linked.get(cohort.id);
  if (saved) return saved;
  if (crmIds.has(cohort.id)) return cohort.id;
  const sameCourse = importClasses.filter((c) => c.course_id === cohort.course_id);
  // The upsert writes code = slug, so this still finds the class after the LMS moves the date.
  const adopted = sameCourse.find((c) => c.code === cohort.slug);
  if (adopted) return adopted.id;
  const twins = cohorts.filter(
    (k) => k.id !== cohort.id && k.course_id === cohort.course_id && k.start_date === cohort.start_date,
  );
  // Two cohorts must never adopt one class: skip classes another cohort holds by code, and
  // with a twin cohort on the date, only the same language adopts.
  const held = new Set(cohorts.map((k) => k.slug));
  const onDate = sameCourse.filter((c) => c.start_date === cohort.start_date && !held.has(c.code));
  const candidates = twins.length ? onDate.filter((c) => c.language === cohort.language) : onDate;
  const found = twins.some((k) => k.language === cohort.language) && candidates.length
    ? "ambiguous"
    : pickClass(candidates, cohort.language);
  if (found === "ambiguous") {
    warnings.push(
      `cohort ${cohort.slug}: SalesProcess classes ${candidates.map((c) => c.code).join(", ")} all match, none adopted`,
    );
    return cohort.id;
  }
  return found ?? cohort.id;
}

// Cohorts mapped to an import class staff cancelled: the sync leaves the class
// and its seats alone, and still maps them so no clashing class is inserted.
export function cohortsOnCancelledClass(
  classOf: Map<string, string>,
  importClasses: ImportClass[],
): Map<string, ImportClass> {
  const cancelled = new Map(importClasses.filter((c) => c.status === "cancelled").map((c) => [c.id, c]));
  return new Map(
    [...classOf].filter(([, id]) => cancelled.has(id)).map(([k, id]) => [k, cancelled.get(id)!]),
  );
}

export type ImportSeat = { id: string; person_id: string; class_id: string; status: string };

// CRM seats an LMS enrollment can adopt: the SalesProcess import's (refunded
// ones included, so a refund is not undone), plus any active seat staff added
// by hand. Until the CRM→LMS handoff is on, Ops add that student in the LMS
// under a new id; adopting keeps one seat instead of a nightly clash warning.
// shortcut: hand seats only matter until the handoff sends CRM ids; drop the OR then.
export async function seatsToAdopt(
  tx: Sql | TransactionSql,
  importIds: string[],
  lmsIds: string[],
): Promise<ImportSeat[]> {
  return tx<ImportSeat[]>`
    SELECT id, person_id, class_id, status FROM enrolment
    WHERE id = ANY(${importIds})
       OR (status <> ALL(${INACTIVE}) AND id <> ALL(${lmsIds}))`;
}

// person|class → the import enrolment there; an active one wins over a refunded one.
export function importSeatsByKey(rows: ImportSeat[]): Map<string, ImportSeat> {
  const seats = new Map<string, ImportSeat>();
  for (const r of rows) {
    const key = `${r.person_id}|${r.class_id}`;
    if (!INACTIVE.includes(r.status)) seats.set(key, r);
    else if (r.status === "refunded" && !seats.has(key)) seats.set(key, r);
  }
  return seats;
}

export type Adoption =
  | { action: "skip-refunded" }
  | { action: "same"; id: string }
  | { action: "update"; id: string; status: "completed"; completed_at: Date };

// What an LMS enrollment does to the import seat of its person and class.
// endedOn: the cohort end date once the class has finished, else null.
// matched: import seats already adopted this run.
export function adoptEnrolment(seat: ImportSeat, endedOn: Date | null, matched: ReadonlySet<string>): Adoption {
  // A SalesProcess refund wins: the seat does not come back while Ops catches up in the LMS.
  if (seat.status === "refunded") return { action: "skip-refunded" };
  // Only confirmed moves, and only forward; a status staff set stays.
  if (endedOn && seat.status === "confirmed" && !matched.has(seat.id))
    return { action: "update", id: seat.id, status: "completed", completed_at: endedOn };
  return { action: "same", id: seat.id };
}

// Import enrolments to cancel: still cancellable (never attended or completed),
// in a class the LMS owns this run that started before today (Kuala Lumpur),
// and not matched to an LMS enrollment this run. Not on the start day itself:
// the 03:00 MYT cron runs before Ops adds that day's attendees to the LMS.
export function cutOverCancels(
  importEnrols: { id: string; class_id: string; status: string }[],
  lmsMappedClassIds: Set<string>,
  matchedIds: Set<string>,
  classStarts: Map<string, string>, // class id → start_date
  today: string,
): string[] {
  return importEnrols
    .filter(
      (e) =>
        CANCELLABLE_STATUSES.includes(e.status) &&
        lmsMappedClassIds.has(e.class_id) &&
        (classStarts.get(e.class_id) ?? today) < today &&
        !matchedIds.has(e.id),
    )
    .map((e) => e.id);
}

export const CUT_OVER_REASON = "Not in the LMS at class start";
// Shown to Ops in the cancel task's notes.
const CUT_OVER_TASK_REASON = `${CUT_OVER_REASON}. Check the LMS for this buyer under another email before refunding.`;

// Each cancelled seat gets an audit_log row (no user: the sync did it) and,
// like every other cancel (§11.1), an EnrolmentCancelled event in the same
// statement. Its handler gives Ops a task per seat: refund, or the buyer is
// in the LMS under another email (then a second person record holds the seat).
// Returns the ids it cancelled; a seat no longer cancellable is skipped.
// Also used for seats gone from the LMS, with GONE_REASON.
export async function cancelCutOver(
  tx: Sql | TransactionSql,
  cut: string[],
  reason = CUT_OVER_REASON,
  taskReason = CUT_OVER_TASK_REASON,
): Promise<string[]> {
  if (!cut.length) return [];
  const rows = await tx`
    WITH old AS (
      SELECT id, status FROM enrolment
      WHERE id = ANY(${cut}) AND status = ANY(${CANCELLABLE_STATUSES}) FOR UPDATE
    ), done AS (
      UPDATE enrolment e SET status = 'cancelled', cancelled_reason = ${reason}
      FROM old WHERE e.id = old.id RETURNING e.id, old.status AS was
    ), raised AS (
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
      SELECT 'EnrolmentCancelled', 'enrolment', id,
             jsonb_build_object('enrolmentId', id, 'reason', ${taskReason}::text)
      FROM done
    )
    INSERT INTO audit_log (user_id, action, entity, entity_id, before, after)
    SELECT NULL, 'update', 'enrolment', id, jsonb_build_object('status', was),
           jsonb_build_object('status', 'cancelled', 'reason', ${reason}::text, 'by', 'sync-lms')
    FROM done RETURNING entity_id`;
  return rows.map((r) => r.entity_id as string);
}

// Seats the LMS has removed (Jaman's point 9, Shawn's answer 3, 16 Nov 2026).
// Only a seat the LMS confirmed (it has an lms_enrollment_id, 028), still
// cancellable, in a class the LMS still has: a whole cohort gone from the LMS
// is left to staff, like the cut-over. Nothing is cancelled when the LMS read
// has no seats at all, or when more than MAX_GONE_CANCELS would go at once:
// that looks like a bad read, not refunds, so it becomes a warning instead.
export const MAX_GONE_CANCELS = 5;
export const GONE_REASON = "Removed from the LMS";
export const GONE_TASK_REASON = `${GONE_REASON}. Check with Ops whether to refund or move this buyer.`;
export type MarkedSeat = { id: string; lms_enrollment_id: string; class_id: string; status: string };
export function goneSeatCancels(
  marked: MarkedSeat[],
  lmsSeatIds: ReadonlySet<string>,
  lmsClassIds: ReadonlySet<string>,
): { cancel: string[]; held: string | null; heldIds: string[] } {
  if (!lmsSeatIds.size)
    return { cancel: [], held: "the LMS read returned no seats: no seat cancelled", heldIds: [] };
  const cancel = marked
    .filter(
      (s) =>
        CANCELLABLE_STATUSES.includes(s.status) &&
        lmsClassIds.has(s.class_id) &&
        !lmsSeatIds.has(s.lms_enrollment_id),
    )
    .map((s) => s.id);
  if (cancel.length > MAX_GONE_CANCELS)
    return {
      cancel: [],
      held: `${cancel.length} seats are gone from the LMS, more than ${MAX_GONE_CANCELS} at once: none cancelled, check by hand`,
      heldIds: cancel,
    };
  return { cancel, held: null, heldIds: [] };
}

// The status the LMS sync writes on a class, or null to leave it. The CRM owns
// class status (Shawn, 16 Nov 2026): a new class gets open or completed; an
// existing one only moves to completed once it has ended, and only from a
// published status. Draft and cancelled are staff's, and the seat trigger
// (006) keeps open/few_seats/full in step with the seats.
const PUBLISHED = ["open", "few_seats", "full"];
export function syncClassStatus(current: string | null, ended: boolean): string | null {
  if (current === null) return ended ? "completed" : "open";
  return ended && PUBLISHED.includes(current) ? "completed" : null;
}
