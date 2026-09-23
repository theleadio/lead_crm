import { getSession } from "./server";
import { ROLES, type Role, type Viewer } from "./permissions";

// ponytail: role_code lives on Shawn's app_user table, which doesn't exist
// yet. Until it does, the role comes from DEV_ROLE so each role can be
// tested. Replace with an app_user lookup (and is_active check, spec §6)
// once the schema lands.
function devRole(): Role {
  // Least privilege if this ever runs in production without a real role.
  if (process.env.NODE_ENV === "production") return "part_time";
  const fromEnv = process.env.DEV_ROLE as Role | undefined;
  return fromEnv && ROLES.includes(fromEnv) ? fromEnv : "super_admin";
}

export type CurrentUser = Viewer & { email: string | null };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSession();
  if (!user) return null;
  return {
    // DEV_USER_ID lets part_time be tested against mock owners (u-1, u-2, u-3).
    id:
      (process.env.NODE_ENV !== "production" && process.env.DEV_USER_ID) ||
      user.id,
    email: user.email ?? null,
    role: devRole(),
  };
}
