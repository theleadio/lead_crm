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

// §9.10 class cancel: the seat-holders a cancellation may still move. attended
// and completed are left out on purpose — those students sat the class, and
// rewriting them to cancelled would rewrite history (Shawn, 6 Oct). A cancel
// is refused outright on a class that has run, so this set is what is left.
export const CANCELLABLE_STATUSES = [
  "reserved",
  "payment_pending",
  "confirmed",
  "onboarded",
];

// Enrolment statuses that mean the class already happened for this student.
// Their presence refuses a cancel (422 `class_started`).
export const PAST_STATUSES = ["attended", "completed"];

// Predicate over an `enrolment` aliased as `e`. Word for word the database's
// `class_seats_taken()` (migration 006), which is the authority since v1.8 —
// a reservation with no `seat_reserved_until` holds no seat there, and the
// 006 trigger fills that column on every reservation, whoever writes it.
// Two definitions that disagree would show seats the booking refuses (§12.11).
// `statuses` narrows the set without copying the expiry rule: the cancel asks
// for CANCELLABLE_STATUSES, everything else counts every seat.
export function seatTakenSql(
  sql: postgres.Sql,
  statuses: readonly string[] = SEAT_STATUSES,
) {
  return sql`e.status IN ${sql(statuses as string[])}
    AND (e.status <> 'reserved' OR e.seat_reserved_until > now())`;
}

// The two §12.1 numbers §7 reports, over an `enrolment` counted for a `class`
// aliased as `c`: live reservations, and every other seat-holding status. The
// expiry rule stays inside seatTakenSql, so an expired reservation drops out
// of both counts without the caller knowing how that is decided. Shared by
// the §9.8/§9.9 class reads and the §9.11 enrolment read, so one screen can
// never show seats another would refuse.
export function seatCountSql(sql: postgres.Sql, reserved: boolean) {
  return sql`(SELECT count(*)::int FROM enrolment e
    WHERE e.class_id = c.id AND ${seatTakenSql(sql)}
      ${reserved ? sql`AND e.status = 'reserved'` : sql`AND e.status <> 'reserved'`})`;
}

// Spec §4 + §9.8: a Kuala Lumpur day, not the server's. Compared against
// `end_date`, not `start_date`, so a class that has started but not finished is
// still upcoming for Operations. Shared by the §9.8 Classes list and the §9.11
// enrolments list, so the two screens cannot disagree about "upcoming".
// `alias` is the class table's alias in the calling query.
export function classWhenSql(
  sql: postgres.Sql,
  when: "upcoming" | "past",
  alias = "c",
) {
  const endDate = sql(`${alias}.end_date`);
  const today = sql`(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`;
  return when === "past"
    ? sql`${endDate} < ${today}`
    : sql`${endDate} >= ${today}`;
}
