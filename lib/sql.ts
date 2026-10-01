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
    globalForSql.__leadSql = postgres(url, { ssl: "require", max: 5 });
  }
  return globalForSql.__leadSql;
}

const txStore = new AsyncLocalStorage<postgres.TransactionSql>();

// The current transaction if one is open, else the pool.
export function db(): Sql {
  return (txStore.getStore() as unknown as Sql) ?? root();
}

// Spec §7 Transactions: check + write in one transaction. Nested calls
// reuse the outer transaction.
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
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
