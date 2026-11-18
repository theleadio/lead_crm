// Tag -> opt-in source backfill (plan docs/superpowers/plans/2026-11-18-
// opt-in-source-tracking.md, phase 2).
//
//   node --env-file=.env.local scripts/backfill-tag-source.ts           dry run
//   node --env-file=.env.local scripts/backfill-tag-source.ts --apply   write
//
// Dry run is read-only: it counts what the mapping covers and lists the tags a
// person still has to map. --apply needs migration 030 and inserts one new
// touchpoint per (person, mapped tag): channel 'import', source_type and
// entry_point from lib/import/tag-source.ts, form_name 'tag-backfill', and
// external_ref 'tag-backfill:<person>:<tag>', so a re-run adds nothing.
//
// Touchpoints are append-only, so old rows are never edited. The tags carry no
// opt-in date (they were stamped on the 30 Oct import), so occurred_at is the
// person's own created_at; the touch is not a first touch. Plain SQL, never
// captureLead(): an import must not fire events (cutover plan, 5 Nov).
import postgres from "postgres";
import { tagSource } from "../lib/import/tag-source.ts";

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const run = async (tx: postgres.TransactionSql) => {
    const tags = await tx<{ id: string; name: string; people: number }[]>`
      SELECT t.id, t.name, count(*)::int AS people
      FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
      GROUP BY t.id, t.name ORDER BY 3 DESC`;
    const mapped = tags.filter((t) => tagSource(t.name));
    const [{ n: tagged }] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT person_id)::int AS n FROM person_tag`;
    const [{ n: covered }] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT person_id)::int AS n FROM person_tag
      WHERE tag_id = ANY(${mapped.map((t) => t.id)}::uuid[])`;

    console.log(`tags: ${tags.length}, mapped: ${mapped.length}`);
    console.log(
      `people with any tag: ${tagged}, with a mapped source tag: ${covered}`,
    );
    console.log("\nmapped (people, tag -> source / entry point):");
    for (const t of mapped) {
      const s = tagSource(t.name)!;
      console.log(
        `  ${t.people}\t${t.name}\t-> ${s.sourceType} / ${s.entryPoint}`,
      );
    }
    console.log("\nunmapped, biggest first (a person decides these):");
    for (const t of tags.filter((t) => !tagSource(t.name)).slice(0, 40))
      console.log(`  ${t.people}\t${t.name}`);

    const [{ has }] = await tx<{ has: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'touchpoint' AND column_name = 'source_type') AS has`;
    if (!has) {
      console.log(
        "\nmigration 030 is not applied: nothing can be written yet.",
      );
      if (apply) process.exit(1);
      return;
    }

    const ids = mapped.map((t) => t.id);
    const types = mapped.map((t) => tagSource(t.name)!.sourceType);
    const entries = mapped.map((t) => tagSource(t.name)!.entryPoint);
    if (!apply) {
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM person_tag pt
        WHERE pt.tag_id = ANY(${ids}::uuid[])
          AND NOT EXISTS (SELECT 1 FROM touchpoint x WHERE x.channel = 'import'
            AND x.external_ref = 'tag-backfill:' || pt.person_id::text || ':' || pt.tag_id::text)`;
      console.log(
        `\ndry run: ${n} touchpoints would be inserted. Use --apply to write.`,
      );
      return;
    }
    const added = await tx`
      INSERT INTO touchpoint (person_id, occurred_at, channel, source_type, entry_point, form_name, external_ref)
      SELECT pt.person_id, p.created_at, 'import', m.source_type, m.entry_point, 'tag-backfill',
             'tag-backfill:' || pt.person_id::text || ':' || pt.tag_id::text
      FROM person_tag pt
      JOIN person p ON p.id = pt.person_id
      JOIN unnest(${ids}::uuid[], ${types}::text[], ${entries}::text[]) AS m(tag_id, source_type, entry_point)
        ON m.tag_id = pt.tag_id
      ON CONFLICT (channel, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
      RETURNING id`;
    console.log(`\napplied: ${added.length} touchpoints inserted.`);
  };
  await (apply ? sql.begin(run) : sql.begin("read only", run));
} finally {
  await sql.end();
}
