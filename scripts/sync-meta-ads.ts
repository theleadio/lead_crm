// Pulls the last N days (default 7: Meta restates recent numbers) of ad-level
// insights from the Meta Marketing API into meta_ad_insight. Safe to re-run.
// Usage: npm run ads:sync [-- --days 30]
import {
  fetchInsights,
  fetchUrlTags,
  upsertInsights,
} from "../lib/ads/meta.ts";
import { closeDb } from "../lib/sql.ts";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 7;
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error("--days must be a whole number from 1 to 90");
  process.exit(2);
}

try {
  const rows = await fetchInsights({ days });
  // url_tags is a second call and must never block the insight rows.
  let tagsFailed = false;
  try {
    const tags = await fetchUrlTags({});
    for (const r of rows) r.urlTags = tags.get(r.adId) ?? null;
  } catch (e) {
    tagsFailed = true;
    console.warn(
      `meta ads: url_tags skipped: ${e instanceof Error ? e.message : e}`,
    );
  }
  const n = await upsertInsights(rows);
  const tagged = rows.filter((r) => r.urlTags).length;
  console.log(
    `meta ads: ${n} ad-day rows upserted (last ${days} days), ${tagged} with url_tags`,
  );
  // A partial sync must be visible, but only after the rows are saved.
  if (tagsFailed) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
