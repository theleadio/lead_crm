import type postgres from "postgres";

// Spec §12.1, the one definition of a taken seat. Waitlisted, cancelled,
// refunded, no_show and transferred-away rows never occupy one, and a
// reservation that has run out frees its seat before anyone cancels it.
export const SEAT_STATUSES = [
  "reserved",
  "payment_pending",
  "confirmed",
  "onboarded",
  "attended",
  "completed",
];

// Predicate over an `enrolment` aliased as `e`. Used by every seat count so
// the class list, the class screens and the enrolment transaction cannot
// drift apart (§12).
export function seatTakenSql(sql: postgres.Sql) {
  return sql`e.status IN ${sql(SEAT_STATUSES)}
    AND (e.status <> 'reserved'
         OR e.seat_reserved_until IS NULL
         OR e.seat_reserved_until > now())`;
}
