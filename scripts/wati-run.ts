// Tries again every WATI event the webhook couldn't finish (database down,
// …), after its wait. Runs every 5 minutes from .github/workflows/wati.yml.
//
//   npm run wati:run
//
// Needs DATABASE_URL. Prints counts only, never a message.
import { runWatiQueue } from "../lib/wati/webhook.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const r = await runWatiQueue();
  console.log(`wati: ${JSON.stringify(r)}`);
  // Red only for an event that ran out of tries.
  if (r.lost > 0) process.exitCode = 1;
} catch (e) {
  // The message only: a database error's detail can hold a phone number, and
  // Actions logs may be public.
  console.error(`wati: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
