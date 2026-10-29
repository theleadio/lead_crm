// Pulls the last N days (default 7: Meta restates recent numbers) of ad-level
// insights from the Meta Marketing API into meta_ad_insight. Safe to re-run.
// Usage: npm run ads:sync [-- --days 30]
import { fetchInsights, upsertInsights } from "../lib/ads/meta.ts";
import { closeDb } from "../lib/sql.ts";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 7;
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error("--days must be a whole number from 1 to 90");
  process.exit(2);
}

try {
  const rows = await fetchInsights({ days });
  const n = await upsertInsights(rows);
  console.log(`meta ads: ${n} ad-day rows upserted (last ${days} days)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
