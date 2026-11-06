import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import { permissionFor, type Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { enquiryRow } from "./list.ts";
import type { EnquiryCategory, EnquiryRow, EnquiryStatus } from "./types.ts";

// PATCH /api/enquiries/:id — the three §9.13 actions that do not create a
// deal. Each is one UPDATE under the §7 If-Match contract with its audit row
// in the same transaction (§4).

export type EnquiryWriteResult =
  | { kind: "ok"; enquiry: EnquiryRow }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "inactive_user" }
  | { kind: "not_open"; status: EnquiryStatus };

// Free text about a person. audit_log is append-only and erase_person() can't
// reach it, so these columns are never copied into an audit row (#48 review).
const UNAUDITED = new Set(["summary", "resolution"]);

type Change = {
  set: Record<string, string | null>;
  // Stamp closed_at with the database's clock in the same UPDATE.
  closing?: boolean;
};

async function writeEnquiry(
  id: string,
  ifMatch: number,
  viewer: Viewer,
  change: (before: postgres.Row) => Promise<Change | EnquiryWriteResult>,
): Promise<EnquiryWriteResult> {
  // §6 "A": part_time writes only an enquiry already assigned to them. The
  // same clause narrows their list (lib/enquiries/list.ts).
  const { allowed, assignedOnly } = permissionFor(viewer, "enquiry", "write");
  if (!allowed) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };

  return withTransaction(async (): Promise<EnquiryWriteResult> => {
    const sql = db();
    const mine = assignedOnly
      ? sql`AND assigned_user_id = ${viewer.id}`
      : sql``;
    // Someone else's enquiry reads as not found to a part-timer, so the
    // refusal does not say whether it exists.
    const [before] = await sql`
      SELECT * FROM enquiry WHERE id = ${id} ${mine} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    // record-concurrency: a stale version is refused before any business
    // rule is judged against a row the user has not seen.
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    const result = await change(before);
    if ("kind" in result) return result;
    const { set, closing } = result;
    const columns = Object.keys(set);

    const [updated] = await sql`
      UPDATE enquiry SET ${sql(set, columns)}
        ${closing ? sql`, closed_at = now()` : sql``}
      WHERE id = ${id} AND version = ${ifMatch} ${mine}
      RETURNING *`;
    // Read FOR UPDATE above at this version, so this cannot miss; kept so a
    // change to the read can never turn into a silent overwrite.
    if (!updated) return { kind: "stale" };

    const audited = [...columns, ...(closing ? ["closed_at"] : [])].filter(
      (c) => !UNAUDITED.has(c),
    );
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "enquiry",
      entityId: id,
      before: Object.fromEntries(audited.map((c) => [c, before[c] ?? null])),
      after: Object.fromEntries(audited.map((c) => [c, updated[c] ?? null])),
    });
    return { kind: "ok", enquiry: (await enquiryRow(id))! };
  });
}

// Assign to the signed-in user ("me"), another active user, or nobody (null).
// Only the roles that write every enquiry hand work out: a part-timer cannot
// take unassigned work or pass their own on (§9.13 spec).
export async function assignEnquiry(
  id: string,
  assignee: string | "me" | null,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  if (permissionFor(viewer, "enquiry", "write").assignedOnly)
    return { kind: "forbidden" };
  const userId = assignee === "me" ? viewer.id : assignee;
  return writeEnquiry(id, ifMatch, viewer, async () => {
    if (userId !== null) {
      const [active] = await db()`
        SELECT 1 FROM app_user WHERE id = ${userId} AND is_active`;
      if (!active) return { kind: "inactive_user" };
    }
    return { set: { assigned_user_id: userId } };
  });
}

export async function setEnquiryCategory(
  id: string,
  category: EnquiryCategory,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async () => ({
    set: { category },
  }));
}

// The one writer of the outcome note. It goes to `summary` (proposal open
// question 3) until #53's `resolution` column lands. The audit row records the
// close (status, handled_by, closed_at), never the note's text. Closing is
// final: no reopen (§9.13 names none).
export async function closeEnquiry(
  id: string,
  close: { status: "human_resolved" | "closed"; note: string },
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async (before) => {
    if (before.status !== "open")
      return { kind: "not_open", status: before.status as EnquiryStatus };
    return {
      set: { status: close.status, summary: close.note, handled_by: "user" },
      closing: true,
    };
  });
}
