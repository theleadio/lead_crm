// Runs one .sql file against DATABASE_URL on a single connection. There is no
// psql on this machine, so Shawn's migrations and his test scripts are applied
// through Node; a single connection is what lets a file carry its own
// BEGIN/COMMIT (postgres.js refuses a transaction on a pooled connection).
//
//   node --env-file=.env.local scripts/run-sql.ts lib/db/migrations/007_reservation_holds.sql
//   node --env-file=.env.local scripts/run-sql.ts lib/db/tests/007_reservation_holds_tests.sql
//
// The test scripts under lib/db/tests roll themselves back; the migrations do
// not. Read the file before running it — it is Shawn's lane (§5).
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-sql.ts <file.sql>");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
try {
  const result = await sql.unsafe(readFileSync(file, "utf8")).simple();
  const rows = (Array.isArray(result) ? result.flat() : [result]).filter(
    Boolean,
  ) as Record<string, unknown>[];
  for (const row of rows) console.log(Object.values(row).join(" | "));
  console.log("OK", file);
} catch (err) {
  const e = err as { message: string; hint?: string; where?: string };
  console.error("FAILED", e.message, e.hint ?? "", e.where ?? "");
  process.exitCode = 1;
} finally {
  await sql.end();
}
