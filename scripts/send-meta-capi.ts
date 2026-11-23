// Sends click-to-WhatsApp conversions to Meta (lib/meta/capi.ts).
//
//   npm run meta:capi                  dry run: counts what is due, sends nothing
//   npm run meta:capi -- --apply       send as TEST events (META_TEST_EVENT_CODE)
//   npm run meta:capi -- --apply --live   send real events (train delivery)
//   npm run meta:capi -- --apply --retry-failed   first make events that gave
//                                      up (or wait out a backoff) due again,
//                                      once the cause is fixed
//
// Needs DATABASE_URL, META_DATASET_ID, META_CAPI_TOKEN, META_WABA_ID (the
// WhatsApp Business Account id the ads click to). Logs print counts only.
// Test sends keep their own ledger, so they never block a later live send.
//
// Not scheduled: run it by hand until Events Manager > Test events shows the
// test events arriving. Only then add a nightly `--apply --live` step to
// .github/workflows/daily-sync.yml (after wati-ctwa), with META_CAPI_TOKEN,
// META_DATASET_ID and META_WABA_ID as Actions secrets.
import { closeDb } from "../lib/sql.ts";
import {
  SOURCE,
  configFromEnv,
  dueConversions,
  gaveUpCount,
  ledgerOf,
  retryFailed,
  sendConversions,
} from "../lib/meta/capi.ts";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
const retry = process.argv.includes("--retry-failed");

async function run() {
  const cfg = apply ? configFromEnv(process.env, live) : null;
  if (typeof cfg === "string") {
    console.error(`Meta CAPI ${cfg}`);
    process.exitCode = 2;
    return;
  }
  if (cfg && cfg.testEventCode === null && !live) {
    console.error(
      "No META_TEST_EVENT_CODE: refusing to send real events without --live.",
    );
    process.exitCode = 2;
    return;
  }
  const source = cfg ? ledgerOf(cfg) : SOURCE;
  if (cfg && retry)
    console.log(
      `made ${await retryFailed(source)} failed or given-up events due again`,
    );
  const due = await dueConversions(new Date(), source);
  const count = (n: string) => due.filter((c) => c.eventName === n).length;
  console.log(
    `due: ${count("LeadSubmitted")} LeadSubmitted, ${count("Purchase")} Purchase`,
  );
  const gave = await gaveUpCount(source);
  if (gave)
    console.log(
      `${gave} events gave up (refused on their own too often): not retried; --retry-failed after fixing the cause`,
    );
  if (!cfg) {
    console.log(
      "DRY RUN: nothing sent. Add --apply (test events) or --apply --live.",
    );
    return;
  }
  let sent = 0;
  let failed = 0;
  let gaveUp = 0;
  let skipped = 0;
  for (let i = 0; i < due.length; i += 500) {
    const r = await sendConversions(due.slice(i, i + 500), cfg);
    sent += r.sent;
    failed += r.failed;
    gaveUp += r.gaveUp;
    skipped += r.skipped;
    if (r.error) console.error(`Meta refused or did not answer: ${r.error}`);
  }
  console.log(
    `${live ? "LIVE" : "TEST"}: sent ${sent}, failed ${failed} (tried again next run), gave up ${gaveUp}` +
      (skipped ? `, ${skipped} already taken by another run` : ""),
  );
  if (failed || gaveUp) process.exitCode = 1;
}

try {
  await run();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
