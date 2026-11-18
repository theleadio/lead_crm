// SalesProcess (GoHighLevel) workshop registrations -> CRM touchpoints, for
// people the ghl:import script already created (12 Nov 2026). Home's Free
// workshops section counts these (lib/home/workshops.ts).
//
//   npm run ghl:forms              dry run: counts only, nothing written
//   npm run ghl:forms -- --apply
//
// Rules:
//  - only dated workshop registration forms (parseWorkshopForm); interest
//    forms, templates and lead magnets are left alone.
//  - a submitter is matched ONLY by the 'ghl:<Contact Id>' reference
//    ghl:import wrote. No match by email or phone, and no person is created.
//  - nothing from the submission is copied but its date and form name: not the
//    name, email or answers, which the person's own record already holds.
//  - append-only and idempotent by external_ref 'ghl-form:<submission id>'.
//  - imports never fire events: touchpoint has no event trigger.
//  - --apply refuses when under half of the submitters are found in this
//    database (it is probably the wrong one).
import postgres from "postgres";
import {
  planFormTouchpoints,
  parseWorkshopForm,
  type GhlForm,
  type GhlFormSubmission,
} from "../lib/import/ghl-forms.ts";
import {
  fetchFormSubmissions,
  fetchForms,
} from "../lib/import/salesprocess-api.ts";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;

async function run(url: string) {
  const forms = (await fetchForms<GhlForm>()).filter((f) =>
    parseWorkshopForm(f.name),
  );
  const submissionsByForm = new Map<string, GhlFormSubmission[]>();
  for (const f of forms)
    submissionsByForm.set(f.id, await fetchFormSubmissions(f.id));

  const sql = postgres(url, {
    ssl: url.includes("sslmode=disable") ? false : "require",
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    await sql.begin(async (tx) => {
      const personOf = new Map<string, string>();
      for (const r of await tx`SELECT external_ref, person_id FROM touchpoint
                             WHERE channel = 'import' AND external_ref LIKE 'ghl:%'`)
        personOf.set(r.external_ref.slice(4), r.person_id);
      const done = new Set(
        (
          await tx`SELECT external_ref FROM touchpoint
                 WHERE channel = 'import' AND external_ref LIKE 'ghl-form:%'`
        ).map((r) => r.external_ref as string),
      );

      const { rows, stats } = planFormTouchpoints(
        forms,
        submissionsByForm,
        personOf,
        done,
      );
      const submitters = new Set(
        [...submissionsByForm.values()].flat().map((s) => s.contactId),
      );
      const found = [...submitters].filter((c) => personOf.has(c)).length;
      stats["submitters"] = submitters.size;
      stats["  found in this CRM"] = found;
      if (apply && submitters.size && found / submitters.size < 0.5)
        throw new Error(
          `refusing to apply: only ${found} of ${submitters.size} submitters are in this database. Wrong database?`,
        );
      if (apply)
        for (let i = 0; i < rows.length; i += 500)
          await tx`INSERT INTO touchpoint ${tx(rows.slice(i, i + 500) as never)}
                 ON CONFLICT DO NOTHING`;
      console.log(apply ? "APPLIED" : "DRY RUN (nothing written)");
      console.table(stats);
      console.log(
        `ghl forms: ${apply ? "applied" : "dry run"} ${JSON.stringify(stats)}`,
      );
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (!url) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 2;
} else {
  await run(url);
}
