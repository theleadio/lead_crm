import type postgres from "postgres";

// Spec §4: a task's due time is a Kuala Lumpur moment. A date with no time
// means 19:00, the end of the §14 business day (9am-7pm MYT), so a task due
// today is not shown as overdue from the morning on (design 5). The
// hrdc_deadline task keeps the start-of-day time lib/deals/hrdc-task.ts gives it.
export const DEFAULT_DUE_TIME = "19:00";

export function dueAtSql(
  sql: postgres.Sql,
  date: string | null | undefined,
  time: string | null | undefined,
) {
  if (!date) return sql`NULL::timestamptz`;
  return sql`((${date}::date + ${time ?? DEFAULT_DUE_TIME}::time)
              AT TIME ZONE 'Asia/Kuala_Lumpur')`;
}
