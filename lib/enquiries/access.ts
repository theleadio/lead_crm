import type postgres from "postgres";
import {
  permissionFor,
  type Action,
  type Role,
  type Viewer,
} from "../auth/permissions.ts";
import { db } from "../sql.ts";

// Who sees and works an enquiry, since teams joined the queue (migration 019).
// Three rules, all in one SQL condition so the list, its total and every
// write agree:
//
//   1. The §6 matrix, as before: support and super_admin write every
//      enquiry; management, sales and operations read; part_time only what
//      is assigned to them; marketing nothing.
//   2. A restricted team's enquiries (Finance: invoice data) are hidden from
//      rule 1 unless the viewer is super_admin or management.
//   3. A team's members read and work their team's enquiries, whatever their
//      role. This is how Finance, Tech and Operations get their work.

type Fragment = postgres.PendingQuery<postgres.Row[]>;

const SEES_RESTRICTED: readonly Role[] = ["super_admin", "management"];
export const seesRestricted = (role: Role) => SEES_RESTRICTED.includes(role);

export async function teamsOf(userId: string): Promise<string[]> {
  const rows = await db()`
    SELECT team_id FROM team_member WHERE user_id = ${userId}`;
  return rows.map((r) => r.team_id as string);
}

// Expects the enquiry as `e`.
export function enquiryAccessSql(
  sql: postgres.Sql,
  viewer: Viewer,
  action: Action,
): Fragment {
  const member = sql`e.team_id IN (
    SELECT team_id FROM team_member WHERE user_id = ${viewer.id})`;
  const { allowed, assignedOnly } = permissionFor(viewer, "enquiry", action);
  if (!allowed) return sql`(${member})`;
  const mine = assignedOnly
    ? sql`e.assigned_user_id = ${viewer.id}`
    : sql`true`;
  const restrictedOk = seesRestricted(viewer.role)
    ? sql`true`
    : sql`NOT EXISTS (
        SELECT 1 FROM team rt WHERE rt.id = e.team_id AND rt.restricted)`;
  return sql`((${mine} AND ${restrictedOk}) OR ${member})`;
}

// Whether the viewer may use the queue at all: the §6 row, or membership of
// any team. Routes and pages check this before the per-row condition.
export async function mayUseEnquiries(
  viewer: Viewer,
  action: Action,
): Promise<boolean> {
  if (permissionFor(viewer, "enquiry", action).allowed) return true;
  return (await teamsOf(viewer.id)).length > 0;
}

// Who may hand an enquiry to someone else: the roles that write every
// enquiry (not part_time's assigned-only kind), and the enquiry's own team.
export async function mayAssign(
  viewer: Viewer,
  teamId: string,
): Promise<boolean> {
  const write = permissionFor(viewer, "enquiry", "write");
  if (write.allowed && !write.assignedOnly) return true;
  return (await teamsOf(viewer.id)).includes(teamId);
}
