// Sets course.list_price_myr from docs/superpowers/notes/2026-10-30-programme-price-list.md.
//
//   node --env-file=.env.local apply-prices.mjs          # show what would change
//   node --env-file=.env.local apply-prices.mjs --write  # write it
//
// The figures are the **self-funded list price, before 8% SST**, exactly as
// the public course pages show them. Two deliberate choices:
//
//  - Not the HRDC price (3,500 / 880). A course has one list price; who paid
//    the grant rate is `deal.funding_type`, which the who-pays chart reads.
//  - Not SST-inclusive. The reference dashboard's RM 734 and RM 3,456 are
//    these numbers plus 8%; storing the advertised figure keeps the column a
//    quotation of the page rather than arithmetic nobody can check.
//
// AI Agents Foundation is its list price, 3,200. The page shows a 2,700
// launch promo; a promo is not the list.
import postgres from "postgres";

const PRICES = [
  ["AI Agentic Automation Certification", "3200.00"],
  ["AI Full-Stack Building Certification", "3200.00"],
  ["Professional AI Engineering Certification", "3200.00"],
  ["AI for Data Science Certification", "3200.00"],
  ["AI Agents Foundation", "3200.00"],
  ["AI Vibe Coding", "680.00"],
  ["Claude AI Mastery", "680.00"],
  ["AI Agents Online Workshop", "228.00"],
];

const write = process.argv.includes("--write");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local).");
  process.exit(1);
}
const sql = postgres(url, {
  ssl: url.includes("sslmode=disable") ? false : "require",
  max: 1,
  prepare: !url.includes(":6543"),
});

const before = await sql`
  SELECT name_en, list_price_myr::text AS price FROM course ORDER BY name_en`;
const known = new Map(PRICES);
const unmatched = PRICES.filter(
  ([name]) => !before.some((c) => c.name_en === name),
);

console.table(
  before.map((c) => ({
    course: c.name_en,
    now: c.price ?? "—",
    becomes: known.get(c.name_en) ?? "(not in the price list)",
  })),
);
if (unmatched.length)
  console.warn(
    "Not found in the database, so skipped:",
    unmatched.map(([n]) => n).join(", "),
  );

if (!write) {
  console.log("\nDry run. Re-run with --write to apply.");
} else {
  let changed = 0;
  for (const [name, price] of PRICES) {
    const rows = await sql`
      UPDATE course SET list_price_myr = ${price}, updated_at = now()
      WHERE name_en = ${name} RETURNING id`;
    changed += rows.length;
  }
  console.log(`\nSet list_price_myr on ${changed} courses.`);
}

await sql.end();
