// One-off CRM -> LMS backfill at go-live (decided 4 Nov, handoff spec §7):
// queues an `enrolment.confirmed` notice for every confirmed or onboarded
// enrolment in a class that hasn't ended. The outbox drain then sends them,
// with its usual retries. Safe to re-run: the LMS upserts by enrolment id.
//
//   npm run lms:backfill                 dry run: counts only, nothing queued
//   npm run lms:backfill -- --apply      queue the notices
//
// Needs DATABASE_URL and LMS_HANDOFF_ENABLED=true (otherwise nothing is
// queued, by design). Prints counts only.
import { lmsHandoffEnabled } from "../lib/lms/send.ts";
import { queueLmsNotice } from "../lib/lms/notices.ts";
import { closeDb, db, withTransaction } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");

try {
  const rows = await db()`
    SELECT e.id FROM enrolment e JOIN class c ON c.id = e.class_id
    WHERE e.status IN ('confirmed','onboarded')
      AND c.status <> 'cancelled'
      AND c.end_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
    ORDER BY c.start_date, e.id`;
  console.log(`enrolments to send: ${rows.length}`);
  if (!apply) {
    console.log("dry run: nothing queued (add --apply)");
  } else if (!lmsHandoffEnabled()) {
    console.error('LMS_HANDOFF_ENABLED is not "true": nothing queued');
    process.exitCode = 1;
  } else {
    await withTransaction(async () => {
      for (const r of rows)
        await queueLmsNotice("enrolment.confirmed", r.id as string);
    });
    console.log(
      `queued ${rows.length} notices; run the outbox drain to send them`,
    );
  }
} finally {
  await closeDb();
}
