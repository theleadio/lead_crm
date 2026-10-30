// SalesProcess (GoHighLevel) attribution -> CRM touchpoints, for people the
// ghl:import script already created. Needs migration 015.
//
//   npm run ghl:attribution                      dry run: counts, rolled back
//   npm run ghl:attribution -- --apply --accept-approx-dates
//   npm run ghl:attribution -- --file contacts.json   contacts as the API returns them
//
// Rules:
//  - a contact is matched ONLY by the 'ghl:<Contact Id>' reference ghl:import
//    wrote on the person's import touchpoint. No match by email or phone, and
//    no person is created.
//  - only attribution records with evidence are kept (campaign, campaign id, ad
//    id or Facebook click id). Placeholders such as {{campaign.name}} are dropped.
//  - append-only: touchpoints are inserted, never updated. Idempotent by
//    external_ref 'ghl-attr:first|last:<Contact Id>'.
//  - the records carry no event date, so every row is dated by the contact's
//    dateAdded. --apply refuses to run without --accept-approx-dates.
//  - --apply also refuses when under half of the contacts with evidence are
//    found in this database (it is probably the wrong one).
//  - not kept: ip, userAgent, fbp, fbc, gaClientId. No consent rows.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { mapContact, type GhlContact } from "../lib/import/ghl-attribution.ts";

const apply = process.argv.includes("--apply");
const approx = process.argv.includes("--accept-approx-dates");
const fi = process.argv.indexOf("--file");
const file = fi > 0 ? process.argv[fi + 1] : undefined;
const url = process.env.DATABASE_URL;
const problem = !url
  ? "DATABASE_URL is not set"
  : apply && !approx
    ? "--apply needs --accept-approx-dates: the records carry no event date, so every touchpoint is dated by the contact's dateAdded."
    : null;

async function loadContacts(): Promise<GhlContact[]> {
  if (file) return JSON.parse(readFileSync(file, "utf8")) as GhlContact[];
  const token = process.env.SALESPROCESS_API_TOKEN;
  const loc = process.env.SALESPROCESS_LOCATION_ID;
  if (!token || !loc)
    throw new Error(
      "SALESPROCESS_API_TOKEN and SALESPROCESS_LOCATION_ID must be set",
    );
  const headers = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
  const all: GhlContact[] = [];
  let next: string | undefined =
    `https://services.leadconnectorhq.com/contacts/?locationId=${loc}&limit=100`;
  while (next) {
    let res: Response | undefined;
    for (let i = 0; i < 4; i++) {
      res = await fetch(next, { headers });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const body = (await res!.json()) as {
      contacts?: GhlContact[];
      meta?: { nextPageUrl?: string };
      message?: string;
    };
    if (!res!.ok)
      throw new Error(
        `SalesProcess API ${res!.status}: ${body.message ?? "no body"}`,
      );
    all.push(...(body.contacts ?? []));
    next = body.meta?.nextPageUrl;
    await new Promise((r) => setTimeout(r, 120));
  }
  return all;
}

async function run(url: string) {
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  const contacts = await loadContacts();
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
                 WHERE channel = 'import' AND external_ref LIKE 'ghl-attr:%'`
        ).map((r) => r.external_ref),
      );

      const rows: Record<string, unknown>[] = [];
      let withEvidence = 0;
      let withEvidenceInCrm = 0;
      for (const c of contacts) {
        bump("contacts read");
        const m = mapContact(c);
        bump("placeholder values dropped", m.placeholders);
        bump("records without evidence skipped", m.noEvidence);
        if (m.noDate) {
          bump("skip: contact has no dateAdded");
          continue;
        }
        if (!m.rows.length) continue;
        withEvidence++;
        const pid = personOf.get(c.id);
        if (!pid) {
          bump("skip: contact not in this CRM (no ghl: reference)");
          continue;
        }
        withEvidenceInCrm++;
        for (const r of m.rows) {
          if (done.has(r.external_ref)) {
            bump("skip: already imported");
            continue;
          }
          rows.push({
            ...r,
            person_id: pid,
            channel: "import",
            form_name: "ghl-attribution",
            is_first_touch: false,
          });
          bump(
            r.external_ref.startsWith("ghl-attr:first")
              ? "touchpoints: first"
              : "touchpoints: last",
          );
          if (r.utm_campaign_id) bump("  with campaign id");
          if (r.utm_ad_id) bump("  with ad id");
          if (r.fbclid) bump("  with fbclid");
          if (r.utm_source === "facebook") bump("  utm_source facebook");
        }
      }
      stats["contacts with evidence"] = withEvidence;
      stats["  found in this CRM"] = withEvidenceInCrm;
      stats["match rate %"] = withEvidence
        ? Math.round((100 * withEvidenceInCrm) / withEvidence)
        : 0;
      if (apply && withEvidence && withEvidenceInCrm / withEvidence < 0.5)
        throw new Error(
          `refusing to apply: only ${withEvidenceInCrm} of ${withEvidence} contacts with evidence are in this database. Wrong database?`,
        );
      for (let i = 0; i < rows.length; i += 500)
        await tx`INSERT INTO touchpoint ${tx(rows.slice(i, i + 500) as never)}
               ON CONFLICT DO NOTHING`;
      if (!apply) throw new Error("dry-run");
    });
  } catch (err) {
    if (!(err instanceof Error && err.message === "dry-run")) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
  if (process.exitCode !== 1) {
    console.log(apply ? "APPLIED" : "DRY RUN (rolled back)");
    console.table(stats);
  }
}

if (problem) {
  console.error(problem);
  process.exitCode = 2;
} else {
  await run(url!);
}
