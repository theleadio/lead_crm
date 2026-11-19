import type postgres from "postgres";

// Spec §12.3 lifecycle stage — computed on read, never stored as truth.
// The one place this rule lives; every query that needs a stage uses it.
//   student: an enrolment in confirmed or later, or at least one succeeded
//            payment (via the person's enrolments or deals)
//   lead:    everything else
// "customer" was dropped (Zixuan, 19 Nov 2026): most students paid through
// SalesProcess or the LMS, which leave no CRM payment row, so the split by
// payment only said which system took the money. Anyone who paid is a student.
// Expects the person table aliased as `p`.
export const STUDENT_STATUSES = [
  "confirmed",
  "onboarded",
  "attended",
  "completed",
  "no_show",
];

export function stageSql(sql: postgres.Sql) {
  return sql`
    CASE
      WHEN EXISTS (
        SELECT 1 FROM payment pay
        WHERE pay.status = 'succeeded'
          AND (pay.enrolment_id IN (SELECT e.id FROM enrolment e WHERE e.person_id = p.id)
            OR pay.deal_id IN (SELECT d.id FROM deal d WHERE d.person_id = p.id AND d.deleted_at IS NULL))
      ) OR EXISTS (
        SELECT 1 FROM enrolment e
        WHERE e.person_id = p.id AND e.status IN ${sql(STUDENT_STATUSES)}
      ) THEN 'student'
      ELSE 'lead'
    END`;
}
