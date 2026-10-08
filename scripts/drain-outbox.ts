// Runs the outbox drain until the queue is empty. Usage: npm run events:drain
import { drainOutbox } from "../lib/events/drain.ts";
import { closeDb } from "../lib/sql.ts";

const total = { claimed: 0, processed: 0, failed: 0 };
try {
  for (;;) {
    const r = await drainOutbox();
    if (r.claimed === 0) break;
    total.claimed += r.claimed;
    total.processed += r.processed;
    total.failed += r.failed;
  }
} finally {
  await closeDb();
}
console.log(
  `claimed ${total.claimed} processed ${total.processed} failed ${total.failed}`,
);
if (total.failed > 0) process.exitCode = 1;
