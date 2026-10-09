// Runs the outbox drain until nothing more is due. A failing row is pushed
// out by its backoff (or marked dead), so it is not re-claimed in this run.
// Usage: npm run events:drain
import { drainOutbox } from "../lib/events/drain.ts";
import { closeDb } from "../lib/sql.ts";

const total = { claimed: 0, processed: 0, failed: 0, dead: 0 };
try {
  for (;;) {
    const r = await drainOutbox();
    if (r.claimed === 0) break;
    total.claimed += r.claimed;
    total.processed += r.processed;
    total.failed += r.failed;
    total.dead += r.dead;
  }
} finally {
  await closeDb();
}
console.log(
  `claimed ${total.claimed} processed ${total.processed} failed ${total.failed} dead ${total.dead}`,
);
if (total.failed > 0) process.exitCode = 1;
