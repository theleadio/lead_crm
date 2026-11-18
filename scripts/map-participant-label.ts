// Map a participant-sheet class label to a CRM class (migration 026).
//
//   npm run participants:map -- --list
//       the labels with no class yet, newest first, with how many people
//   npm run participants:map -- "n8n: 11-12 nov" --date 2026-11-11 --class <class code>
//       dry run: says what it would do
//   ... --apply
//       writes it; a manual mapping is never changed by the sync again
//
// Labels hold no personal data. Counts only otherwise.
import { closeDb, db } from "../lib/sql.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 2;
} else {
  try {
    const sql = db();
    if (args.includes("--list")) {
      const rows = await sql`
        SELECT l.label_norm, l.class_date::text AS class_date, count(e.person_id)::int AS people
        FROM participant_class_label l
        LEFT JOIN participant_entry e USING (label_norm, class_date)
        WHERE l.class_id IS NULL
        GROUP BY l.label_norm, l.class_date
        ORDER BY l.class_date DESC, people DESC
        LIMIT 100`;
      for (const r of rows)
        console.log(`${r.class_date}  ${r.people}  ${r.label_norm}`);
      console.log(`${rows.length} unmatched labels`);
    } else {
      const label = args.find(
        (a) =>
          !a.startsWith("--") && a !== flag("--date") && a !== flag("--class"),
      );
      const date = flag("--date");
      const code = flag("--class");
      if (!label || !date || !code) {
        console.error(
          'Usage: --list, or "<label>" --date YYYY-MM-DD --class <class code> [--apply]',
        );
        process.exitCode = 2;
      } else {
        const [k] = await sql`SELECT id FROM class WHERE code = ${code}`;
        const [l] = await sql`
          SELECT 1 FROM participant_class_label
          WHERE label_norm = ${label.toLowerCase().replace(/\s+/g, " ").trim()} AND class_date = ${date}::date`;
        if (!k || !l) {
          console.error(
            `${!k ? "No class with that code. " : ""}${!l ? "No such label on that date (see --list)." : ""}`,
          );
          process.exitCode = 1;
        } else {
          if (apply)
            await sql`
              UPDATE participant_class_label SET class_id = ${k.id}, source = 'manual', updated_at = now()
              WHERE label_norm = ${label.toLowerCase().replace(/\s+/g, " ").trim()} AND class_date = ${date}::date`;
          console.log(`${apply ? "mapped" : "dry run: would map"} 1 label`);
        }
      }
    }
  } finally {
    await closeDb();
  }
}
