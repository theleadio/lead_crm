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

// Predicate over an `enrolment` aliased as `e`. Word for word the database's
// `class_seats_taken()` (migration 006), which is the authority since v1.8 —
// a reservation with no `seat_reserved_until` holds no seat there, and the
// 006 trigger fills that column on every reservation, whoever writes it.
// Two definitions that disagree would show seats the booking refuses (§12.11).
export function seatTakenSql(sql: postgres.Sql) {
  return sql`e.status IN ${sql(SEAT_STATUSES)}
    AND (e.status <> 'reserved' OR e.seat_reserved_until > now())`;
}
