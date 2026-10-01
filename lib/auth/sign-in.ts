import { clientIp, writeAudit } from "../audit.ts";
import { db } from "../sql.ts";

// Spec §6 Audit + §14: every sign-in, failed sign-in and sign-out is logged,
// and an account locks after 5 failures in 15 minutes. Failure counts come
// straight from audit_log (audit_log_user_idx), so no extra table.

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

export const WRONG_LOGIN = "Wrong email or password. Try again.";

// The slice of the Supabase client we use, so tests can stub it.
export type AuthClient = {
  auth: {
    signInWithPassword(c: {
      email: string;
      password: string;
    }): Promise<{ error: unknown }>;
    signOut(): Promise<unknown>;
  };
};

async function serverClient(): Promise<AuthClient> {
  return (await import("./server.ts")).createClient();
}

// A same-site path only: blocks https://evil.com, //evil.com and /\evil.com.
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next)
    ? next
    : "/people";
}

// Minutes until the lock lifts, or 0 when the account isn't locked.
async function lockedMinutes(userId: string): Promise<number> {
  const rows = await db()`
    SELECT ceil(extract(epoch FROM (at + make_interval(mins => ${WINDOW_MINUTES}) - now())) / 60)::int AS mins
    FROM audit_log
    WHERE user_id = ${userId} AND action = 'sign_in_failed'
      AND at > now() - make_interval(mins => ${WINDOW_MINUTES})
    ORDER BY at DESC LIMIT ${MAX_FAILURES}`;
  return rows.length < MAX_FAILURES
    ? 0
    : Math.max(1, rows[MAX_FAILURES - 1].mins);
}

export async function signIn(
  email: string,
  password: string,
  forwardedFor: string | null,
  client?: AuthClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = clientIp(forwardedFor);
  const [user] = await db()`
    SELECT id FROM app_user WHERE lower(email) = lower(${email})`;
  const userId: string | null = user?.id ?? null;

  // ponytail: two simultaneous attempts can both pass this check and allow a
  // 6th failure; add a per-user advisory lock if that ever matters.
  if (userId) {
    const mins = await lockedMinutes(userId);
    if (mins > 0)
      return {
        ok: false,
        error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      };
  }

  const { error } = await (
    client ?? (await serverClient())
  ).auth.signInWithPassword({ email, password });
  if (error) console.error("sign-in rejected by Supabase:", error);
  // Unknown emails log with no user and no email, so strangers' data isn't kept.
  await writeAudit({
    userId,
    action: error ? "sign_in_failed" : "sign_in",
    entity: "app_user",
    entityId: userId,
    before: null,
    after: null,
    ip,
  });
  return error ? { ok: false, error: WRONG_LOGIN } : { ok: true };
}

export async function signOut(
  user: { id: string } | null,
  forwardedFor: string | null,
  client?: AuthClient,
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
  await (client ?? (await serverClient())).auth.signOut();
}
