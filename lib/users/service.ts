import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import type { Role, Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { UserUpdate } from "../validation/user.ts";

// Spec §9.15 Users, §6, §7 /api/users. super_admin only; the routes check.

export type UserStatus = "active" | "not_signed_in" | "deactivated";

export type UserRow = {
  id: string;
  // Integer row version (migration 005); every PATCH sends it back.
  version: number;
  email: string;
  fullName: string;
  roleCode: Role;
  status: UserStatus;
  lastLoginAt: string | null;
};

export type UserWriteResult =
  | { kind: "ok"; user: UserRow }
  | { kind: "not_found" }
  | { kind: "stale" }
  // 422: your own role or active flag (design 6).
  | { kind: "self_change" }
  // 422: would leave no active super_admin.
  | { kind: "last_super_admin" };

function toUserRow(r: postgres.Row): UserRow {
  return {
    id: r.id,
    version: Number(r.version),
    email: r.email,
    fullName: r.full_name,
    roleCode: r.role_code,
    status: !r.is_active
      ? "deactivated"
      : r.last_login_at
        ? "active"
        : "not_signed_in",
    lastLoginAt: r.last_login_at
      ? new Date(r.last_login_at).toISOString()
      : null,
  };
}

// Every user, deactivated ones last, then by name.
export async function listUsers(): Promise<UserRow[]> {
  const rows = await db()`
    SELECT * FROM app_user ORDER BY is_active DESC, lower(full_name), id`;
  return rows.map(toUserRow);
}

// Body field → column, for the SET and the audit row.
const COLUMNS = {
  roleCode: "role_code",
  isActive: "is_active",
} as const;

export async function updateUser(
  id: string,
  body: UserUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<UserWriteResult> {
  if (!isUuid(id)) return { kind: "not_found" };
  // Checked first, needing no lock: nobody locks themselves out.
  if (
    id === viewer.id &&
    (body.roleCode !== undefined || body.isActive !== undefined)
  )
    return { kind: "self_change" };

  return withTransaction(async (): Promise<UserWriteResult> => {
    const sql = db();
    // Design 6: serialises every user write, so two demotions at once can't
    // both see the other as the remaining super_admin.
    await sql`SELECT pg_advisory_xact_lock(hashtext('app_user_super_admin'))`;
    const [before] = await sql`SELECT * FROM app_user WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    const changed = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (k) => body[k] !== undefined && body[k] !== before[COLUMNS[k]],
    );
    if (!changed.length) return { kind: "ok", user: toUserRow(before) };

    const removesSuperAdmin =
      before.role_code === "super_admin" &&
      before.is_active &&
      (changed.includes("isActive") ||
        (changed.includes("roleCode") && body.roleCode !== "super_admin"));
    if (removesSuperAdmin) {
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM app_user
        WHERE role_code = 'super_admin' AND is_active AND id <> ${id}`;
      if (n === 0) return { kind: "last_super_admin" };
    }

    const set = Object.fromEntries(changed.map((k) => [COLUMNS[k], body[k]]));
    const [after] = await sql`
      UPDATE app_user SET ${sql(set)}
      WHERE id = ${id} AND version = ${ifMatch} RETURNING *`;
    // Read FOR UPDATE at this version, so this cannot miss; kept so a change
    // to the read can never become a silent overwrite.
    if (!after) return { kind: "stale" };

    // §6 Audit: a role change is a permission change; the rest is an update
    // with only the fields that changed.
    const audit = async (
      action: "permission_change" | "update",
      keys: (keyof typeof COLUMNS)[],
    ) =>
      keys.length &&
      (await writeAudit({
        userId: viewer.id,
        action,
        entity: "app_user",
        entityId: id,
        before: Object.fromEntries(keys.map((k) => [k, before[COLUMNS[k]]])),
        after: Object.fromEntries(keys.map((k) => [k, after[COLUMNS[k]]])),
      }));
    await audit(
      "permission_change",
      changed.filter((k) => k === "roleCode"),
    );
    await audit(
      "update",
      changed.filter((k) => k !== "roleCode"),
    );
    return { kind: "ok", user: toUserRow(after) };
  });
}
