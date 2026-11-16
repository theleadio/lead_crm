import { clientIp, writeAudit } from "../audit.ts";
import { isUuid } from "../people/service.ts";
import { db } from "../sql.ts";

// Spec §6 Audit + §14: every sign-in, failed sign-in and sign-out is logged.
// AI365 says who someone is; app_user is the allowlist that says whether they
// may use the CRM: an active row with that email, case-insensitive. The CRM
// stores no passwords.

// A same-site path only: blocks https://evil.com, //evil.com and /\evil.com.
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next)
    ? next
    : "/people";
}

// The app_user id when that person is active staff, else null. Either way the
// attempt is audited; a refusal stores no user and no email, so a stranger's
// address (a course learner, say) is never kept.
export async function signIn(
  who: { email: string } | { id: string },
  method: "ai365" | "dev",
  forwardedFor: string | null,
): Promise<string | null> {
  const sql = db();
  const [user] =
    "email" in who
      ? await sql`SELECT id, is_active FROM app_user
                  WHERE lower(email) = lower(${who.email})`
      : isUuid(who.id)
        ? await sql`SELECT id, is_active FROM app_user WHERE id = ${who.id}`
        : [];
  const userId: string | null = user?.is_active ? user.id : null;

  // §9.15 Users: the last sign-in, which the Users tab shows as the status.
  if (userId)
    await sql`UPDATE app_user SET last_login_at = now() WHERE id = ${userId}`;
  await writeAudit({
    userId,
    action: userId ? "sign_in" : "sign_in_failed",
    entity: "app_user",
    entityId: userId,
    before: null,
    after: { method },
    ip: clientIp(forwardedFor),
  });
  return userId;
}

export async function signOut(
  user: { id: string } | null,
  forwardedFor: string | null,
): Promise<void> {
  if (user)
    await writeAudit({
      userId: user.id,
      action: "sign_out",
      entity: "app_user",
      entityId: user.id,
      before: null,
      after: null,
      ip: clientIp(forwardedFor),
    });
}
