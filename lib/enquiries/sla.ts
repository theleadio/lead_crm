import type postgres from "postgres";
import { isActiveStatus, type EnquiryStatus } from "./types.ts";

// Spec §9.13 past-SLA highlight. Since migration 019 an enquiry carries its
// own deadline, `sla_due_at`: the next working day in office hours
// (lib/enquiries/deadline.ts, decided 4 Nov). That is the rule wherever it is
// set.
//
// An enquiry without one (written before 019, or by a writer that set none)
// falls back to the older rule: the `first_response_sla_minutes` setting
// (O4), elapsed minutes, read at run time so changing it needs no release.

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

// The one predicate. Late only while open or waiting on the customer: judged
// on the reply once there is one (so a timely reply stops being late however
// old the enquiry gets), otherwise on now. The deadline has to be passed.
//
// `overDueSeconds` is (first reply, or now) minus `sla_due_at`, worked out by
// the database's clock; null when the enquiry has no deadline.
export function isPastSla(
  e: {
    status: EnquiryStatus;
    waitedMinutes: number;
    responseMinutes: number | null;
    overDueSeconds?: number | null;
  },
  limit: number | null,
): boolean {
  if (!isActiveStatus(e.status)) return false;
  if (e.overDueSeconds != null) return e.overDueSeconds > 0;
  if (limit === null) return false;
  return (e.responseMinutes ?? e.waitedMinutes) > limit;
}
