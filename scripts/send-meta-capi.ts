// Sends click-to-WhatsApp conversions to Meta (lib/meta/capi.ts).
//
//   npm run meta:capi                  dry run: counts what is due, sends nothing
//   npm run meta:capi -- --apply       send as TEST events (META_TEST_EVENT_CODE)
//   npm run meta:capi -- --apply --live   send real events (train delivery)
//
// Needs DATABASE_URL, META_DATASET_ID, META_CAPI_TOKEN, META_WABA_ID (the
// WhatsApp Business Account id the ads click to). Logs print counts only.
// Test sends keep their own ledger, so they never block a later live send.
import { closeDb } from "../lib/sql.ts";
import {
  SOURCE,
  configFromEnv,
  dueConversions,
  ledgerOf,
  sendConversions,
} from "../lib/meta/capi.ts";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");

async function run() {
  const cfg = apply ? configFromEnv(process.env, live) : null;
  if (typeof cfg === "string") {
    console.error(`Meta CAPI ${cfg}`);
    process.exitCode = 2;
    return;
  }
  if (cfg && cfg.testEventCode === null && !live) {
    console.error("No META_TEST_EVENT_CODE: refusing to send real events without --live.");
    process.exitCode = 2;
    return;
  }
  const due = await dueConversions(new Date(), cfg ? ledgerOf(cfg) : SOURCE);
  const count = (n: string) => due.filter((c) => c.eventName === n).length;
  console.log(`due: ${count("LeadSubmitted")} LeadSubmitted, ${count("Purchase")} Purchase`);
  if (!cfg) {
    console.log("DRY RUN: nothing sent. Add --apply (test events) or --apply --live.");
    return;
  }
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i += 500) {
    const r = await sendConversions(due.slice(i, i + 500), cfg);
    sent += r.sent;
    failed += r.failed;
    if (r.error) console.error(`batch failed: ${r.error}`);
  }
  console.log(`${live ? "LIVE" : "TEST"}: sent ${sent}, failed ${failed}`);
  if (failed) process.exitCode = 1;
}

try {
  await run();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
