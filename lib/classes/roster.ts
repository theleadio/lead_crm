import { requirePermission, type Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { displayName } from "../people/types.ts";
import { db } from "../sql.ts";
import { seatTakenSql } from "./seats.ts";
import type { RosterRow } from "./types.ts";

// Who is in one class (spec §9.10 Roster, §5 `enrolment`, §6, §12.1).
// Read-only: adding an enrolment, changing a status and transferring belong
// to §9.11, so nothing here writes. Lives under `lib/classes/` because the
// question is class-shaped; §9.11's own service can absorb it (design 2).

// §6 enrolment row: super_admin, management, sales, support and operations
// read. Marketing and part_time have no access at all, so the tab is not
// rendered for them and this throws if a route ever asks anyway.
export async function listRoster(
  classId: string,
  viewer: Viewer,
): Promise<RosterRow[]> {
  requirePermission(viewer, "enrolment", "read");
  if (!isUuid(classId)) return [];
  const sql = db();
  const rows = await sql`
    SELECT e.id, e.person_id, e.status, e.payer_type, e.price_paid_myr,
           e.seat_reserved_until, e.created_at,
           -- The phone is read to stand in for a missing name (§11.2) and is
           -- never reported: displayName() below decides what leaves here.
           p.full_name, p.phone, b.full_name AS booker_full_name, b.phone AS booker_phone,
           ${seatTakenSql(sql)} AS holds_seat
    FROM enrolment e
    JOIN person p ON p.id = e.person_id
    LEFT JOIN person b ON b.id = e.booker_person_id
    WHERE e.class_id = ${classId}
    -- Seat-holders first (§9.10), then by name so the list is stable.
    ORDER BY (${seatTakenSql(sql)}) DESC, lower(coalesce(p.full_name, '')), e.id`;

  return rows.map((r) => ({
    id: r.id as string,
    personId: r.person_id as string,
    personName: displayName(r.full_name as string, r.phone as string | null),
    status: r.status as string,
    payerType: r.payer_type as string,
    bookerName:
      r.booker_full_name === null && r.booker_phone === null
        ? null
        : displayName(
            r.booker_full_name as string | null,
            r.booker_phone as string | null,
          ),
    // §4: money as a decimal string, never a float.
    pricePaidMyr: r.price_paid_myr === null ? null : String(r.price_paid_myr),
    seatReservedUntil:
      r.seat_reserved_until === null
        ? null
        : new Date(r.seat_reserved_until as string).toISOString(),
    createdAt: new Date(r.created_at as string).toISOString(),
    holdsSeat: r.holds_seat as boolean,
  }));
}
