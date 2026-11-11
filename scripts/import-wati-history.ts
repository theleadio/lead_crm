// WhatsApp history from WATI into the inbox, for people already in the CRM
// (cutover plan WP5). Rules: lib/wati/history.ts.
//
//   npm run wati:history                     dry run: counts, rolled back
//   npm run wati:history -- --apply          write
//   npm run wati:history -- --days 7         only chats updated in the last 7 days
//                                            (for a nightly delta)
//
// Needs DATABASE_URL, WATI_API_HOST (host only) and WATI_API_TOKEN, and
// migration 020. Reads WATI only. A full read is one request per chat
// (several thousand): about half an hour. Prints counts only, never a
// message or a number: Actions logs can be public.
import { watiReader } from "../lib/wati/api.ts";
import { importWatiHistory } from "../lib/wati/history.ts";
import { closeDb, withTransaction } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");
const daysAt = process.argv.indexOf("--days");
const days = daysAt > 0 ? Number(process.argv[daysAt + 1]) : undefined;
const host = process.env.WATI_API_HOST;
const token = process.env.WATI_API_TOKEN;
if (
  !process.env.DATABASE_URL ||
  !host ||
  !token ||
  (days !== undefined && !(days > 0))
) {
  console.error(
    "usage: DATABASE_URL, WATI_API_HOST and WATI_API_TOKEN must be set; --days needs a positive number",
  );
  process.exit(1);
}

class DryRun extends Error {}
let stats: Record<string, number> = {};
try {
  const run = async () => {
    stats = await importWatiHistory(watiReader({ host, token }), { days });
    if (!apply) throw new DryRun();
  };
  // A dry run does the whole thing inside one transaction and rolls it back;
  // --apply commits chat by chat, so an interrupted run keeps what it did.
  if (apply) await run();
  else await withTransaction(run);
} catch (e) {
  if (!(e instanceof DryRun)) {
    console.error(
      `wati history: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
console.log(
  `wati history: ${process.exitCode ? "failed" : apply ? "applied" : "dry run (rolled back)"} ${JSON.stringify(stats)}`,
);
