// SalesProcess (GoHighLevel) registration forms -> CRM touchpoints (12 Nov
// 2026). Pure: no network, no database. Used by scripts/import-ghl-forms.ts
// and by Home's Free workshops section (lib/home/workshops.ts).
//
// A free workshop's registration form is named with its date, e.g.
//   ".02 LEAD - AI Vibe Coding Masterclass 18 Nov 2026"
//   ".02 LEAD - AI Vibe Coding 氛围编程讲座表格 - 12 Nov 2026"
// Its submissions are the real registrations: on 12 Nov GHL held 142 and 157
// for these two, where the contacts' first/last ad attribution (ghl:attribution)
// tied only 75 and 31 people to the campaigns, and Meta's pixel reported 325
// and 370.

export type WorkshopKey = {
  title: string;
  language: "en" | "zh";
  // YYYY-MM-DD
  date: string;
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

// "<anything> LEAD - <title> [- ]<day> <Mon> <YYYY>"
const WORKSHOP_FORM =
  /\bLEAD\s*-\s*(.+?)\s*(?:-\s*)?(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\s*$/i;
// Han characters: a Chinese-language workshop names itself in Chinese.
const CJK = /\p{Script=Han}/u;

// null for forms that are not a dated workshop registration (interest forms,
// templates, lead magnets), so they never show up as a workshop.
export function parseWorkshopForm(name: string): WorkshopKey | null {
  const m = WORKSHOP_FORM.exec(name);
  if (!m) return null;
  const title = m[1].replace(/\s*-\s*$/, "").trim();
  const month = MONTHS.indexOf(m[3].toLowerCase());
  const day = Number(m[2]);
  const year = Number(m[4]);
  if (!title || month < 0) return null;
  const at = new Date(Date.UTC(year, month, day));
  if (at.getUTCMonth() !== month || at.getUTCDate() !== day) return null;
  return {
    title,
    language: CJK.test(title) ? "zh" : "en",
    date: at.toISOString().slice(0, 10),
  };
}

export type GhlForm = { id: string; name: string };
// Only the fields the import uses; the API also returns the submitter's name,
// email and answers, which are never copied (the person is already in the CRM).
export type GhlFormSubmission = {
  id: string;
  contactId: string;
  createdAt: string;
};

export type FormTouchpointRow = {
  person_id: string;
  channel: "import";
  form_name: string;
  occurred_at: string;
  is_first_touch: false;
  external_ref: string;
};

// One touchpoint per submission of a workshop form, on the person the
// ghl:import script created for that contact (`personOf`: contact id ->
// person id). `done` holds the external_refs already imported, so a re-run
// adds nothing twice.
export function planFormTouchpoints(
  forms: GhlForm[],
  submissionsByForm: Map<string, GhlFormSubmission[]>,
  personOf: Map<string, string>,
  done: Set<string>,
): { rows: FormTouchpointRow[]; stats: Record<string, number> } {
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const rows: FormTouchpointRow[] = [];
  for (const form of forms) {
    if (!parseWorkshopForm(form.name)) continue;
    bump("workshop forms");
    for (const s of submissionsByForm.get(form.id) ?? []) {
      bump("submissions read");
      const ref = `ghl-form:${s.id}`;
      if (done.has(ref)) {
        bump("skip: already imported");
        continue;
      }
      const person = personOf.get(s.contactId);
      if (!person) {
        bump("skip: contact not in this CRM");
        continue;
      }
      rows.push({
        person_id: person,
        channel: "import",
        form_name: form.name,
        occurred_at: s.createdAt,
        is_first_touch: false,
        external_ref: ref,
      });
      bump("touchpoints");
    }
  }
  return { rows, stats };
}
