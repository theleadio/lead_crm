// WATI click-to-WhatsApp opt-ins -> CRM `ctwa` touchpoints (lib/import/wati-ctwa.ts).
//
//   npm run wati:ctwa                         dry run, last 3 days: counts, rolled back
//   npm run wati:ctwa -- --apply              write
//   npm run wati:ctwa -- --apply --since 2026-10-01   backfill
//
// Reads WATI's contacts newest-updated first and stops at --since, then each
// contact's messages from --since on. Idempotent: a touchpoint is keyed on the
// Meta click id (see ctwaRef). Logs are public in CI: counts only, no numbers.
//
// ponytail: one contact at a time (one getMessages call each); 6,396 contacts
// on 11 Nov. Fine for a daily window; a full backfill takes a while. The WATI
// webhook port (lead_sales#19 -> lead_crm) should call saveCtwaTouch live.
import { closeDb, rollbackAfter } from "../lib/sql.ts";
import {
  referralOf,
  saveCtwaTouch,
  sentAt,
  watiContactsSince,
  watiMessagesSince,
} from "../lib/import/wati-ctwa.ts";

const apply = process.argv.includes("--apply");
const si = process.argv.indexOf("--since");
const since =
  si > 0
    ? new Date(`${process.argv[si + 1]}T00:00:00+08:00`)
    : new Date(Date.now() - 3 * 86_400_000);

if (Number.isNaN(since.getTime())) {
  console.error("--since needs a date like 2026-10-01");
  process.exit(2);
}

const stats: Record<string, number> = {};
const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

async function run() {
  for await (const c of watiContactsSince(since)) {
    bump("contacts read");
    if (!c.wAid) continue;
    const msgs = await watiMessagesSince(c.wAid, since);
    // Oldest first, so a person's first ad click is the one marked first touch.
    msgs.sort((a, b) => (sentAt(a)?.getTime() ?? 0) - (sentAt(b)?.getTime() ?? 0));
    let had = false;
    for (const m of msgs) {
      const r = referralOf(m);
      const at = sentAt(m);
      if (!r || !at) continue;
      if (!had) bump("contacts with an ad referral");
      had = true;
      const res = await saveCtwaTouch(c.wAid, c.fullName ?? null, r, at);
      if (res.kind === "saved") {
        bump("touchpoints added");
        if (res.firstTouch) bump("  first touch (new opt-in)");
        if (res.newPerson) bump("  new person created");
        if (!r.ctwaClid) bump("  without click id");
      } else if (res.kind === "exists") bump("already recorded");
      else bump(`skip: ${res.reason}`);
    }
  }
}

try {
  if (apply) await run();
  else await rollbackAfter(run);
  console.log(apply ? "APPLIED" : "DRY RUN (rolled back)", `since ${since.toISOString()}`);
  console.table(stats);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
