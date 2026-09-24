import { db } from "./sql.ts";

// Spec §4 Audit: every create, update, delete, export and permission change
// writes an audit_log row; §6 adds every payment view. Runs inside the
// caller's transaction when there is one, so the audit row and the change
// commit together.

export type AuditEntry = {
  userId: string;
  action:
    "create" | "update" | "delete" | "export" | "permission_change" | "view";
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO audit_log (user_id, action, entity, entity_id, before, after)
    VALUES (
      ${entry.userId}, ${entry.action}, ${entry.entity}, ${entry.entityId},
      ${entry.before == null ? null : sql.json(entry.before as never)},
      ${entry.after == null ? null : sql.json(entry.after as never)}
    )`;
}
