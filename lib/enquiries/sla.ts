import type postgres from "postgres";
import type { EnquiryStatus } from "./types.ts";

// Spec §9.13 past-SLA highlight. The threshold is the `first_response_sla_minutes`
// setting (O4), read at run time so changing it needs no release. Elapsed
// minutes, not §14 business hours: that is what the setting's name and unit
// say (proposal open question 2).

// Read once per request. Null when the row is missing or not a positive whole
// number: nothing is marked late rather than guessing a limit in code.
export async function slaMinutes(sql: postgres.Sql): Promise<number | null> {
  // Read as text and checked here: `::int` in SQL would throw on a bad value
  // and take the whole queue down with it.
  const [row] = await sql`
    SELECT value #>> '{}' AS minutes FROM app_setting
    WHERE key = 'first_response_sla_minutes'`;
  const raw = row?.minutes as string | null | undefined;
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  const minutes = Number(raw);
  return minutes >= 1 ? minutes : null;
}

// The one predicate. Late only while `open`: judged on the reply once there
// is one (so a timely reply stops being late however old the enquiry gets),
// otherwise on how long it has waited. The limit has to be exceeded.
export function isPastSla(
  e: {
    status: EnquiryStatus;
    waitedMinutes: number;
    responseMinutes: number | null;
  },
  limit: number | null,
): boolean {
  if (limit === null || e.status !== "open") return false;
  return (e.responseMinutes ?? e.waitedMinutes) > limit;
}
