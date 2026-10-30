// SalesProcess (GoHighLevel) contact export → CRM people, tags and an
// `import` touchpoint each.
//
//   npm run ghl:import -- <export.md>            dry run: counts, rolled back
//   npm run ghl:import -- <export.md> --apply    write
//
// The export is a markdown table: Contact Id, First Name, Last Name, Phone,
// Email, Business Name, Created, Last Activity, Tags. Rules:
//  - skipped: no email AND no phone (nothing to reach), tagged "test email" or "internal".
//  - one person per email, else per phone, across the file AND the CRM. A match
//    never overwrites the CRM person: it only gains tags and a touchpoint.
//  - no consent rows are written. Absence of a row means no consent (spec §14);
//    a GHL contact is not proof of PDPA opt-in.
//  - idempotent: touchpoint (channel 'import', external_ref 'ghl:<Contact Id>')
//    is the marker; a contact already imported is skipped.
//  - tags: names kept as-is; "[bracket] ..." names are system tags (spec §5).
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { normalizePhoneE164 } from "../lib/format/phone.ts";

const file = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!file || !process.env.DATABASE_URL) {
  console.error(
    "usage: node --env-file=.env.local scripts/import-ghl-contacts.ts <export.md> [--apply]",
  );
  process.exit(1);
}

// --- parse the markdown table
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim());
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
const header = cells(lines[0]);
const rows = lines
  .slice(2)
  .map((l) => Object.fromEntries(cells(l).map((c, i) => [header[i], c])));
// GHL escapes "|" inside a tag as &#124;; tags are comma separated, quoted when they hold a comma.
const tagsOf = (s: string): string[] =>
  s
    .replaceAll("&#124;", "|")
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/) // commas outside double quotes
    .map((t) => t.trim().replace(/^"|"$/g, "").trim())
    .filter(Boolean);

const SKIP_TAGS = new Set(["test email", "internal"]);

// --- plan
const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
  onnotice: () => {},
});
const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

try {
  await sql.begin(async (tx) => {
    const byEmail = new Map<string, string>();
    const byPhone = new Map<string, string>();
    for (const p of await tx`SELECT id, email_norm, phone_e164 FROM person WHERE deleted_at IS NULL AND merged_into_id IS NULL`) {
      if (p.email_norm) byEmail.set(p.email_norm, p.id);
      if (p.phone_e164) byPhone.set(p.phone_e164, p.id);
    }
    const done = new Set(
      (
        await tx`SELECT external_ref FROM touchpoint WHERE channel = 'import' AND external_ref LIKE 'ghl:%'`
      ).map((r) => r.external_ref),
    );
    const tagId = new Map(
      (await tx`SELECT id, name FROM tag`).map((t) => [
        t.name.toLowerCase(),
        t.id as string,
      ]),
    );

    const newPeople: Record<string, unknown>[] = [];
    const touches: Record<string, unknown>[] = [];
    const wantTags = new Map<string, Set<string>>(); // person id -> tag names
    const newTagNames = new Map<string, string>(); // lower -> display
    const firstTouched = new Set<string>();

    for (const r of rows) {
      const ref = `ghl:${r["Contact Id"]}`;
      const tags = tagsOf(r["Tags"]);
      const email = r["Email"].trim();
      const phone = r["Phone"].trim();
      if (done.has(ref)) {
        bump("skip: already imported");
        continue;
      }
      if (!email && !phone) {
        bump("skip: no email or phone");
        continue;
      }
      if (tags.some((t) => SKIP_TAGS.has(t.toLowerCase()))) {
        bump("skip: test/internal tag");
        continue;
      }

      const e164 = phone ? normalizePhoneE164(phone) : null;
      let pid =
        (email && byEmail.get(email.toLowerCase())) ||
        (e164 && byPhone.get(e164)) ||
        undefined;
      const created = new Date(r["Created"]);
      if (pid) {
        bump("matched existing/earlier person");
      } else {
        pid = crypto.randomUUID();
        const name = `${r["First Name"]} ${r["Last Name"]}`.trim();
        const reason =
          phone && !e164 ? "phone_unnormalised" : !name ? "no_name" : null;
        newPeople.push({
          id: pid,
          full_name: name || "(no name)",
          email: email || null,
          phone: phone || null,
          phone_e164: e164,
          preferred_language: tags.some(
            (t) => t.toLowerCase() === "[language] chinese",
          )
            ? "zh"
            : "en",
          company_name_given: r["Business Name"].slice(0, 200) || null,
          needs_review: reason !== null,
          needs_review_reason: reason,
          created_at: created,
        });
        if (email) byEmail.set(email.toLowerCase(), pid);
        if (e164) byPhone.set(e164, pid);
        bump("new person");
        if (reason) bump(`  of which needs_review: ${reason}`);
      }
      const first =
        newPeople.some((p) => p.id === pid) && !firstTouched.has(pid);
      if (first) firstTouched.add(pid);
      touches.push({
        person_id: pid,
        occurred_at: created,
        channel: "import",
        form_name: "ghl-export",
        is_first_touch: first,
        external_ref: ref,
      });
      const set = wantTags.get(pid) ?? new Set<string>();
      for (const t of tags) {
        set.add(t);
        if (!tagId.has(t.toLowerCase())) newTagNames.set(t.toLowerCase(), t);
      }
      wantTags.set(pid, set);
    }

    const chunk = async <T>(xs: T[], f: (c: T[]) => Promise<unknown>) => {
      for (let i = 0; i < xs.length; i += 500) await f(xs.slice(i, i + 500));
    };
    await chunk(newPeople, (c) => tx`INSERT INTO person ${tx(c as never)}`);
    const addedTags = [...newTagNames.values()].map((name) => ({
      name,
      is_system: name.startsWith("["),
    }));
    await chunk(
      addedTags,
      (c) => tx`INSERT INTO tag ${tx(c)} ON CONFLICT DO NOTHING`,
    );
    for (const t of await tx`SELECT id, name FROM tag`)
      tagId.set(t.name.toLowerCase(), t.id);
    // first-touch index is unique per person: a person from this file gets at most one.
    await chunk(
      touches,
      (c) =>
        tx`INSERT INTO touchpoint ${tx(c as never)} ON CONFLICT DO NOTHING`,
    );
    const links = [...wantTags].flatMap(([person_id, names]) =>
      [...names].map((n) => ({
        person_id,
        tag_id: tagId.get(n.toLowerCase()),
      })),
    );
    await chunk(
      links,
      (c) =>
        tx`INSERT INTO person_tag ${tx(c as never)} ON CONFLICT DO NOTHING`,
    );
    bump("new tags", addedTags.length);
    bump("touchpoints", touches.length);
    bump("person_tag links", links.length);
    if (!apply) throw new Error("dry-run");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "dry-run")) throw err;
} finally {
  await sql.end();
}
console.log(
  `${rows.length} rows, ${apply ? "APPLIED" : "DRY RUN (rolled back)"}`,
);
console.table(stats);
