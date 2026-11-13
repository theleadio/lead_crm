// Nightly auto-link of Meta campaigns to classes (12 Nov 2026), after the
// Meta sync, so Home's class cards count WhatsApp opt-ins without anyone
// linking by hand. The rules live in autoLinkCampaigns (lib/classes/campaigns.ts):
// date and a course word in the campaign name, exactly one fitting class,
// never re-adding a link someone removed.
//
//   npm run campaigns:link              dry run: counts only, nothing written
//   npm run campaigns:link -- --apply
//   npm run campaigns:link -- --list    also print class code and campaign name
//
// CI logs are public: by default only counts are printed.
import { autoLinkCampaigns } from "../lib/classes/campaigns.ts";
import { closeDb } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");
const list = process.argv.includes("--list");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 2;
} else {
  try {
    const { links, stats } = await autoLinkCampaigns({ apply });
    if (list)
      for (const l of links) console.log(`  ${l.classCode} <- ${l.name}`);
    console.log(
      `campaign auto-link: ${apply ? "applied" : "dry run"} ${JSON.stringify(stats)}`,
    );
  } finally {
    await closeDb();
  }
}
