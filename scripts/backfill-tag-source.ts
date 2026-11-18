// Dry run of the tag -> opt-in source backfill (plan phase 2). Read-only: it
// counts what the mapping would cover and lists the tags still to be mapped by
// a person. It writes nothing. --apply is refused until the plan's phase 1
// decision (touchpoint columns or form_name) is made.
//
//   node --env-file=.env.local scripts/backfill-tag-source.ts
import postgres from "postgres";
import { tagSource } from "../lib/import/tag-source.ts";

if (process.argv.includes("--apply")) {
  console.error(
    "--apply is not built: waiting for the phase 1 decision (plan 2026-11-18).",
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const { tags, people, covered } = await sql.begin("read only", async (tx) => {
    const tags = await tx<{ name: string; people: number }[]>`
      SELECT t.name, count(*)::int AS people
      FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
      GROUP BY t.name ORDER BY 2 DESC`;
    const mapped = tags.filter((t) => tagSource(t.name)).map((t) => t.name);
    const [{ n: people }] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT person_id)::int AS n FROM person_tag`;
    const [{ n: covered }] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT pt.person_id)::int AS n
      FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
      WHERE t.name = ANY(${mapped})`;
    return { tags, people, covered };
  });

  const mapped = tags.filter((t) => tagSource(t.name));
  console.log(`tags: ${tags.length}, mapped: ${mapped.length}`);
  console.log(
    `people with any tag: ${people}, with a mapped source tag: ${covered}`,
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
} finally {
  await sql.end();
}
