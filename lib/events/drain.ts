import type postgres from "postgres";
import { db, withTransaction } from "../sql.ts";
import { handlers as registry, type EventHandler } from "./handlers.ts";

export const MAX_ATTEMPTS = 5;

// Spec §11.1: claims pending outbox rows (FOR UPDATE SKIP LOCKED, so
// concurrent drains never share a row) and runs each handler in a savepoint,
// so a failing handler's writes roll back while the row's bookkeeping stays.
// A row at MAX_ATTEMPTS is left pending as a dead letter.
export async function drainOutbox(
  opts: { batch?: number; handlers?: Record<string, EventHandler> } = {},
): Promise<{ claimed: number; processed: number; failed: number }> {
  const batch = opts.batch ?? 20;
  const handlers: Record<string, EventHandler | undefined> =
    opts.handlers ?? registry;

  return withTransaction(async () => {
    const sql = db();
    const rows = await sql`
      SELECT id, type, aggregate_id, payload FROM event_outbox
      WHERE processed_at IS NULL AND attempts < ${MAX_ATTEMPTS}
      ORDER BY created_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED`;

    let processed = 0;
    let failed = 0;
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
        await sql`
          UPDATE event_outbox
          SET attempts = attempts + 1, last_error = ${message}, updated_at = now()
          WHERE id = ${r.id}`;
        failed++;
      }
    }
    return { claimed: rows.length, processed, failed };
  });
}
