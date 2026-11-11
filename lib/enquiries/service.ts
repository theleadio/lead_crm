import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import { permissionFor, type Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import {
  enquiryAccessSql,
  mayAssign,
  mayUseEnquiries,
  teamsOf,
} from "./access.ts";
import { enquiryRow } from "./list.ts";
import {
  categoryTeam,
  enquiryEvent,
  isActiveMember,
  nextInTeam,
  noteAssigned,
  teamHasActiveMembers,
  teamIsRestricted,
  UnknownCategory,
} from "./routing.ts";
import {
  isActiveStatus,
  type EnquiryCategory,
  type EnquiryPriority,
  type EnquiryRow,
  type EnquiryStatus,
} from "./types.ts";

// PATCH /api/enquiries/:id — the §9.13 actions that do not create a deal, plus
// the two from the ticket design (migration 019): waiting on the customer, and
// priority. Each is one UPDATE under the §7 If-Match contract, with its audit
// row and its history row (`enquiry_event`) in the same transaction (§4).

export type EnquiryWriteResult =
  | { kind: "ok"; enquiry: EnquiryRow }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "inactive_user" }
  | { kind: "not_in_team" }
  | { kind: "unknown_category" }
  | { kind: "not_open"; status: EnquiryStatus }
  // Convert only (convert.ts): the deal rules refused the deal, or the
  // enquiry's person has been deleted or merged away since.
  | { kind: "deal_refused"; fields: Record<string, string> }
  | { kind: "person_gone" };

// Free text about a person. audit_log is append-only and erase_person() can't
// reach it, so these columns are never copied into an audit row (#48 review).
const UNAUDITED = new Set(["summary", "resolution", "subject"]);

type Change = {
  set: Record<string, string | null>;
  // Stamp closed_at with the database's clock in the same UPDATE.
  closing?: boolean;
  // The history row: ids and codes only (the event's before/after can never
  // be erased).
  event?: {
    kind: "status" | "assigned" | "category";
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  // After the UPDATE: move the assignee to the back of the round robin.
  assigned?: { teamId: string; userId: string | null };
};

// Exported for convert.ts, so converting closes an enquiry exactly as every
// other write does.
export async function writeEnquiry(
  id: string,
  ifMatch: number,
  viewer: Viewer,
  change: (before: postgres.Row) => Promise<Change | EnquiryWriteResult>,
): Promise<EnquiryWriteResult> {
  if (!(await mayUseEnquiries(viewer, "write"))) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };

  return withTransaction(async (): Promise<EnquiryWriteResult> => {
    const sql = db();
    // §6 "A", restricted teams and team membership (access.ts): an enquiry
    // the viewer may not work reads as not found, so the refusal does not
    // say whether it exists.
    const [before] = await sql`
      SELECT e.* FROM enquiry e
      WHERE e.id = ${id} AND ${enquiryAccessSql(sql, viewer, "write")}
      FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    // record-concurrency: a stale version is refused before any business
    // rule is judged against a row the user has not seen.
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    const result = await change(before);
    if ("kind" in result) return result;
    const { set, closing, event, assigned } = result;
    const columns = Object.keys(set);

    const [updated] = await sql`
      UPDATE enquiry SET ${sql(set, columns)}
        ${closing ? sql`, closed_at = now()` : sql``}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING *`;
    // Read FOR UPDATE above at this version, so this cannot miss; kept so a
    // change to the read can never turn into a silent overwrite.
    if (!updated) return { kind: "stale" };

    if (assigned) await noteAssigned(assigned.teamId, assigned.userId);
    if (event)
      await enquiryEvent(id, viewer.id, event.kind, event.before, event.after);
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
// Handing work out is for the roles that write every enquiry and for the
// enquiry's own team: a part-timer cannot take unassigned work or pass their
// own on (§9.13 spec). A restricted team's enquiry (Finance) goes only to a
// member of that team, who are the only people besides super_admin and
// management who can open it.
export async function assignEnquiry(
  id: string,
  assignee: string | "me" | null,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  // A part-timer in no team can never hand work out: refused before the
  // row is looked up, as before migration 019.
  const write = permissionFor(viewer, "enquiry", "write");
  if (write.assignedOnly && (await teamsOf(viewer.id)).length === 0)
    return { kind: "forbidden" };
  const userId = assignee === "me" ? viewer.id : assignee;
  return writeEnquiry(id, ifMatch, viewer, async (before) => {
    const teamId = before.team_id as string;
    if (!(await mayAssign(viewer, teamId))) return { kind: "forbidden" };
    if (userId !== null) {
      const [active] = await db()`
        SELECT 1 FROM app_user WHERE id = ${userId} AND is_active`;
      if (!active) return { kind: "inactive_user" };
      if (
        (await teamIsRestricted(teamId)) &&
        !(await isActiveMember(teamId, userId))
      )
        return { kind: "not_in_team" };
    }
    return {
      set: { assigned_user_id: userId },
      event: {
        kind: "assigned",
        before: { assignedUserId: before.assigned_user_id ?? null },
        after: { assignedUserId: userId },
      },
      assigned: { teamId, userId },
    };
  });
}

// A new category moves the enquiry to that category's team. The assignee
// stays unless the new team has members and they are not one of them; then
// the team's round robin picks.
export async function setEnquiryCategory(
  id: string,
  category: EnquiryCategory,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async (before) => {
    let teamId: string;
    try {
      teamId = await categoryTeam(category);
    } catch (e) {
      if (e instanceof UnknownCategory) return { kind: "unknown_category" };
      throw e;
    }
    let assignee = (before.assigned_user_id as string | null) ?? null;
    if (
      teamId !== before.team_id &&
      (await teamHasActiveMembers(teamId)) &&
      !(assignee && (await isActiveMember(teamId, assignee)))
    )
      assignee = await nextInTeam(teamId);
    return {
      set: { category, team_id: teamId, assigned_user_id: assignee },
      event: {
        kind: "category",
        before: {
          category: before.category ?? null,
          teamId: before.team_id,
          assignedUserId: before.assigned_user_id ?? null,
        },
        after: { category, teamId, assignedUserId: assignee },
      },
      assigned:
        assignee !== before.assigned_user_id
          ? { teamId, userId: assignee }
          : undefined,
    };
  });
}

// Open ↔ waiting on the customer. Neither is closing, so both are offered
// only while the enquiry is still being worked.
export async function setEnquiryStatus(
  id: string,
  status: "open" | "waiting_customer",
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async (before) => {
    if (!isActiveStatus(before.status as EnquiryStatus))
      return { kind: "not_open", status: before.status as EnquiryStatus };
    return {
      set: { status },
      event: {
        kind: "status",
        before: { status: before.status },
        after: { status },
      },
    };
  });
}

export async function setEnquiryPriority(
  id: string,
  priority: EnquiryPriority,
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async () => ({
    set: { priority },
  }));
}

// The one writer of the outcome note. It goes to `resolution` (migration 018),
// so the enquiry keeps its own `summary`. The audit row records the close
// (status, handled_by, closed_at), never the note's text. Closing is final:
// no reopen (§9.13 names none); a customer who writes again gets a new
// enquiry linked to this one (create.ts followUpEnquiry).
export async function closeEnquiry(
  id: string,
  close: { status: "human_resolved" | "closed"; note: string },
  ifMatch: number,
  viewer: Viewer,
): Promise<EnquiryWriteResult> {
  return writeEnquiry(id, ifMatch, viewer, async (before) => {
    if (!isActiveStatus(before.status as EnquiryStatus))
      return { kind: "not_open", status: before.status as EnquiryStatus };
    return {
      set: { status: close.status, resolution: close.note, handled_by: "user" },
      closing: true,
      event: {
        kind: "status",
        before: { status: before.status },
        after: { status: close.status },
      },
    };
  });
}

// An internal note: a history row only, so it needs no If-Match (it changes
// nothing anyone could be editing). Anyone who may work the enquiry may add
// one. The text is erased with the person (migration 019).
export async function addEnquiryNote(
  id: string,
  note: string,
  viewer: Viewer,
): Promise<{ kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" }> {
  if (!(await mayUseEnquiries(viewer, "write"))) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async () => {
    const sql = db();
    const [e] = await sql`
      SELECT e.id FROM enquiry e
      WHERE e.id = ${id} AND ${enquiryAccessSql(sql, viewer, "write")}`;
    if (!e) return { kind: "not_found" as const };
    await enquiryEvent(id, viewer.id, "note", null, null, note);
    return { kind: "ok" as const };
  });
}

// When a reply goes out to the customer: the first one stops the deadline
// clock and moves nothing else. Called by the reply senders (WATI, email)
// once they are ported here; a reply never needs the user's If-Match.
export async function markFirstResponse(
  id: string,
  actorId: string | null,
): Promise<void> {
  await withTransaction(async () => {
    const [e] = await db()`
      UPDATE enquiry SET first_response_at = now()
      WHERE id = ${id} AND first_response_at IS NULL
      RETURNING id`;
    if (e) await enquiryEvent(id, actorId, "first_response", null, null);
  });
}
