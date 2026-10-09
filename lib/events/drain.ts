import type postgres from "postgres";
import { db, withTransaction } from "../sql.ts";
import { handlers as registry, type EventHandler } from "./handlers.ts";

export const MAX_ATTEMPTS = 5;

// Seconds to wait after failure number n (n = the row's new attempts value,
// 1..MAX_ATTEMPTS-1) before the row is claimed again; the failure that reaches
// MAX_ATTEMPTS makes it a dead letter instead. The schedule is a decision, not
// a law: change the numbers here, no migration needed.
export const BACKOFF_SECONDS = [30, 120, 600, 3600];

// Spec §11.1: claims due, live, pending outbox rows (FOR UPDATE SKIP LOCKED,
// so concurrent drains never share a row; oldest next_attempt_at first, seq
// breaks ties so events raised together run in the order they were raised) and
// runs each handler in a savepoint, so a failing handler's writes roll back
// while the row's bookkeeping stays. A failure pushes next_attempt_at out by
// the backoff; the failure that reaches MAX_ATTEMPTS sets dead_at (migration
// 010), and a dead row stays pending until retryDeadEvents() revives it.
export async function drainOutbox(
  opts: { batch?: number; handlers?: Record<string, EventHandler> } = {},
): Promise<{
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
}> {
  const batch = opts.batch ?? 20;
  const handlers: Record<string, EventHandler | undefined> =
    opts.handlers ?? registry;

  return withTransaction(async () => {
    const sql = db();
    const rows = await sql`
      SELECT id, type, aggregate_id, payload, attempts FROM event_outbox
      WHERE processed_at IS NULL AND dead_at IS NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at, seq
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED`;

    let processed = 0;
    let failed = 0;
    let dead = 0;
    for (const r of rows) {
      const handler = handlers[r.type];
      try {
        if (handler)
          await (sql as unknown as postgres.TransactionSql).savepoint(() =>
            handler({
              id: r.id,
              type: r.type,
              aggregateId: r.aggregate_id,
              payload: r.payload,
            }),
          );
        await sql`
          UPDATE event_outbox
          SET processed_at = now(), attempts = attempts + 1, last_error = NULL,
              updated_at = now()
          WHERE id = ${r.id}`;
        processed++;
      } catch (err) {
        const message = (
          err instanceof Error ? err.message : String(err)
        ).slice(0, 500);
        const n = r.attempts + 1; // the row is locked, so this is exact
        if (n >= MAX_ATTEMPTS) {
          await sql`
            UPDATE event_outbox
            SET attempts = ${n}, last_error = ${message}, dead_at = now(),
                updated_at = now()
            WHERE id = ${r.id}`;
          dead++;
        } else {
          const wait = BACKOFF_SECONDS[Math.min(n, BACKOFF_SECONDS.length) - 1];
          await sql`
            UPDATE event_outbox
            SET attempts = ${n}, last_error = ${message},
                next_attempt_at = now() + make_interval(secs => ${wait}),
                updated_at = now()
            WHERE id = ${r.id}`;
        }
        failed++;
      }
    }
    return { claimed: rows.length, processed, failed, dead };
  });
}

// Brings dead letters back (the §11.4 Retry button): clears dead_at, resets
// attempts and makes the row due now. Without ids, every dead row. Returns the
// number of rows revived. last_error is kept until the next success.
export async function retryDeadEvents(ids?: string[]): Promise<number> {
  const sql = db();
  if (ids === undefined) {
    const r = await sql`
      UPDATE event_outbox
      SET dead_at = NULL, attempts = 0, next_attempt_at = now()
      WHERE dead_at IS NOT NULL
      RETURNING id`;
    return r.length;
  }
  if (ids.length === 0) return 0;
  const r = await sql`
    UPDATE event_outbox
    SET dead_at = NULL, attempts = 0, next_attempt_at = now()
    WHERE dead_at IS NOT NULL AND id = ANY(${ids}::uuid[])
    RETURNING id`;
  return r.length;
}
