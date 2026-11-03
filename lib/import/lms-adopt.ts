import { CANCELLABLE_STATUSES } from "../classes/seats.ts";
import { pickClass } from "./salesprocess-enrolments.ts";

export type Cohort = { id: string; slug: string; course_id: string; start_date: string; language: "en" | "zh" };
export type ImportClass = { id: string; code: string; course_id: string; start_date: string; language: "en" | "zh" };

const INACTIVE = ["cancelled", "refunded", "transferred"];

// cohort → CRM class id: its own id if the CRM has it, else the import class it
// adopted on an earlier run (code = slug), else the one import class of that
// course and start date, else its own id (a new class).
export function classIdForCohort(
  cohort: Cohort,
  crmIds: Set<string>,
  importClasses: ImportClass[],
  cohorts: Cohort[],
  warnings: string[],
): string {
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

export type ImportSeat = { id: string; person_id: string; class_id: string; status: string };

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
// in a class the LMS owns this run that has started, and not matched to an LMS
// enrollment this run.
export function cutOverCancels(
  importEnrols: { id: string; class_id: string; status: string }[],
  lmsMappedClassIds: Set<string>,
  matchedIds: Set<string>,
  startedClassIds: Set<string>,
): string[] {
  return importEnrols
    .filter(
      (e) =>
        CANCELLABLE_STATUSES.includes(e.status) &&
        lmsMappedClassIds.has(e.class_id) &&
        startedClassIds.has(e.class_id) &&
        !matchedIds.has(e.id),
    )
    .map((e) => e.id);
}
