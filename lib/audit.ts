// Spec §4 Audit: every create, update, delete, export and permission change
// writes an audit_log row. ponytail: in-memory until Shawn's audit_log table
// lands — same call shape, so callers don't change when it's swapped.

export type AuditEntry = {
  userId: string;
  // "view": spec §6 — every view of a payment record is audit-logged.
  action:
    "create" | "update" | "delete" | "export" | "permission_change" | "view";
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  at: string;
};

export const MOCK_AUDIT_LOG: AuditEntry[] = [];

export async function writeAudit(entry: Omit<AuditEntry, "at">): Promise<void> {
  MOCK_AUDIT_LOG.push({ ...entry, at: new Date().toISOString() });
}
