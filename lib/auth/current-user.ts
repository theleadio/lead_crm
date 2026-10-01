import { db } from "../sql";
import { getSession } from "./server";
import { ROLES, type Role, type Viewer } from "./permissions";

export type CurrentUser = Viewer & { email: string | null; fullName: string };

// Spec §6 + v1.2: the signed-in auth user maps to an app_user through
// auth_user_id. A deactivated or unlinked user gets no access on their
// next request (null → 401).
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  const dev = process.env.NODE_ENV !== "production";
  // Dev only: act as another app_user to test roles (e.g. a part-timer).
  const candidate = dev ? process.env.DEV_USER_ID?.trim() : undefined;
  const actAs =
    candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : undefined;

  const sql = db();
  const [user] = actAs
    ? await sql`SELECT id, email, full_name, role_code FROM app_user
                WHERE id = ${actAs} AND is_active`
    : await sql`SELECT id, email, full_name, role_code FROM app_user
                WHERE auth_user_id = ${session.id} AND is_active`;
  if (!user) return null;

  const override = dev ? (process.env.DEV_ROLE?.trim() as Role) : undefined;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: override && ROLES.includes(override) ? override : user.role_code,
  };
}
