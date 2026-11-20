import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "../sql";
import { SESSION_COOKIE, verifySession } from "./session";
import { ROLES, type Role, type Viewer } from "./permissions";

export type CurrentUser = Viewer & {
  email: string | null;
  fullName: string;
  // Member of at least one enquiry team (019). Read in the same query as the
  // user so the CRM shell costs one database round trip, not two.
  inTeam: boolean;
};

// Spec §6: the CRM's signed session cookie (lib/auth/session.ts) names an
// app_user. A deactivated user gets no access on their next request
// (null → 401), even with a cookie that is still valid.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await verifySession(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session) return null;

  const dev = process.env.NODE_ENV !== "production";
  // Dev only: act as another app_user to test roles (e.g. a part-timer).
  const candidate = dev ? process.env.DEV_USER_ID?.trim() : undefined;
  const actAs =
    candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : undefined;

  const sql = db();
  const [user] = actAs
    ? await sql`SELECT id, email, full_name, role_code,
                       EXISTS (SELECT 1 FROM team_member
                               WHERE user_id = app_user.id) AS in_team
                FROM app_user WHERE id = ${actAs} AND is_active`
    : await sql`SELECT id, email, full_name, role_code,
                       EXISTS (SELECT 1 FROM team_member
                               WHERE user_id = app_user.id) AS in_team
                FROM app_user WHERE id = ${session.uid} AND is_active`;
  if (!user) return null;

  const override = dev ? (process.env.DEV_ROLE?.trim() as Role) : undefined;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    inTeam: Boolean(user.in_team),
    role: override && ROLES.includes(override) ? override : user.role_code,
  };
});
