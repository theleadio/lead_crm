import { isIP } from "node:net";
import { db } from "./sql.ts";

// Spec §4 Audit: every create, update, delete, export and permission change
// writes an audit_log row; §6 adds every payment view. Runs inside the
// caller's transaction when there is one, so the audit row and the change
// commit together.

export type AuditEntry = {
  // Null only for a failed sign-in with an email that isn't a staff account.
  userId: string | null;
  action:
    | "create"
    | "update"
    | "delete"
    | "export"
    | "permission_change"
    | "view"
    | "sign_in"
    | "sign_in_failed"
    | "sign_out"
    | "permission_denied";
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip?: string | null;
};

// First x-forwarded-for hop, or null when absent or not an IP (audit_log.ip
// is inet, so a junk header must not fail the insert).
export function clientIp(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(",")[0].trim();
  return first && isIP(first) ? first : null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO audit_log (user_id, action, entity, entity_id, before, after, ip)
    VALUES (
      ${entry.userId}, ${entry.action}, ${entry.entity}, ${entry.entityId},
      ${entry.before == null ? null : sql.json(entry.before as never)},
      ${entry.after == null ? null : sql.json(entry.after as never)},
      ${entry.ip ?? null}
    )`;
}
