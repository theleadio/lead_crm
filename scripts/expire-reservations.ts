// Runs expire_reservations() once: every reserved enrolment whose hold has
// passed becomes cancelled ('reservation_expired') and raises its outbox
// event (migration 006). Safe to run at any time. Spec §12.1: a scheduled job
// on DigitalOcean runs this every 15 minutes (O48).
// Usage: npm run reservations:expire
import { closeDb, db } from "../lib/sql.ts";

let expired = 0;
try {
  const [r] = await db()`SELECT expire_reservations() AS n`;
  expired = r.n;
} finally {
  await closeDb();
}
console.log(`expired ${expired}`);
