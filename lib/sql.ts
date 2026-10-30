import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

// ponytail: plain parameterised SQL against Shawn's schema (lib/db/migrations)
// until he picks Prisma/Drizzle (spec §2). Only /lib services import this —
// never screens (spec §2, §3 layering). Tagged templates are parameterised,
// so no string-built SQL (spec §14).

type Sql = postgres.Sql;

const globalForSql = globalThis as unknown as { __leadSql?: Sql };

function root(): Sql {
  if (!globalForSql.__leadSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Cached on globalThis so dev hot-reload doesn't open a new pool each time.
    globalForSql.__leadSql = postgres(url, {
      // Production stays on TLS; a local Postgres opts out with ?sslmode=disable.
      ssl: url.includes("sslmode=disable") ? false : "require",
      // Supabase's session pooler caps clients at its pool size (15 on Free),
      // shared by every server. A serverless function (Netlify runs on
      // Lambda) gets one connection, and idle ones are released, so warm
      // functions don't hold the pool: "max clients reached in session mode".
      max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 1 : 5,
      idle_timeout: 20,
      // Supabase's pooler (port 6543, transaction mode) drops prepared
      // statements between queries: "prepared statement ... does not exist".
      prepare: !url.includes(":6543"),
    });
  }
  return globalForSql.__leadSql;
}

const txStore = new AsyncLocalStorage<postgres.TransactionSql>();

// The current transaction if one is open, else the pool.
export function db(): Sql {
  return (txStore.getStore() as unknown as Sql) ?? root();
}

// Spec §7 Transactions: check + write in one transaction. A nested call joins
// the open transaction through a SAVEPOINT rather than running inside it bare:
// Postgres aborts a whole transaction on any failed statement, so a service
// that catches a database error — migration 008's unique index on a proof
// file, say (§9.12) — would otherwise leave the outer transaction unusable and
// the caught refusal would surface as a different error further on. Rolling
// back to the savepoint keeps the outer work alive, which is what lets a
// service answer "already recorded" and carry on.
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const open = txStore.getStore();
  if (open) return (await open.savepoint((sp) => txStore.run(sp, fn))) as T;
  return (await root().begin((tx) => txStore.run(tx, fn))) as T;
}

class Rollback extends Error {}

// Tests: run fn inside a transaction that is always rolled back.
export async function rollbackAfter(fn: () => Promise<void>): Promise<void> {
  try {
    await root().begin(async (tx) => {
      await txStore.run(tx, fn);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

export async function closeDb(): Promise<void> {
  await globalForSql.__leadSql?.end();
  globalForSql.__leadSql = undefined;
}
