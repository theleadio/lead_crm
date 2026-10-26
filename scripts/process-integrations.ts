// Retries Stripe events that are due (received or failed, backoff elapsed)
// until none is left. The DigitalOcean scheduled job runs this.
// Usage: npm run integrations:process
import { processStripeEvents } from "../lib/integrations/stripe.ts";
import { closeDb } from "../lib/sql.ts";

const total = { claimed: 0, processed: 0, failed: 0, dead: 0 };
try {
  for (;;) {
    const r = await processStripeEvents();
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
