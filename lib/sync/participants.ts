// Sync of the "LEAD Participant List 2026" Google Sheet into the CRM (migration
// 026). An Apps Script in the sheet posts its rows here; each row is a person
// and a comma list of classes they attended, e.g. "N8N: 11-12 Nov (HRDC),
// Claude: 1 Nov". Ops add a row when someone signs up, so the hour a person
// and class are first seen is the signup date.
//
// The parsing and class matching are pure and tested without a database
// (tests/participants.test.ts); `syncParticipants` is the part that writes.
// Nothing here logs a name, email or phone number: the repo and its CI logs
// are public (PDPA, spec §14), so results are counts only.

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "../audit.ts";
import { normalizeEmail, isValidEmail } from "../format/email.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { findDuplicate } from "../people/dedupe.ts";
import { raiseDuplicateTask } from "../people/duplicate-review.ts";
import { dedupeCandidates } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";

// ---- Key ---------------------------------------------------------------------

const digest = (s: string) => createHash("sha256").update(s).digest();

// PARTICIPANT_SYNC_KEY is its own secret, held only by the Apps Script. It is
// never PUBLIC_API_KEY: browsers hold that one, and this endpoint creates
// people (Zhixuan's review, 18 Nov). Several keys may be listed, comma
// separated, so one can be rotated without a gap. Unset, shorter than 16
// characters, or equal to a public key = closed.
export function syncKeys(env: Record<string, string | undefined>): string[] {
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length >= 16);
  const publicKeys = new Set(list(env.PUBLIC_API_KEY));
  return list(env.PARTICIPANT_SYNC_KEY).filter((k) => !publicKeys.has(k));
}

export function checkSyncKey(
  env: Record<string, string | undefined>,
  presented: string | null,
): "ok" | "bad" | "unconfigured" {
  const keys = syncKeys(env);
  if (keys.length === 0) return "unconfigured";
  // Hashed to 32 bytes first, so neither the value nor its length leaks
  // through timing, and every key is always compared.
  const got = digest(presented ?? "");
  let ok = false;
  for (const k of keys) if (timingSafeEqual(digest(k), got)) ok = true;
  return ok ? "ok" : "bad";
}

// ---- Request -----------------------------------------------------------------

export const MAX_ROWS = 100;

export const syncBodySchema = z.object({
  // sync: first seen now. backfill: the one-off load of history, dated by
  // the class date and flagged approximate.
  mode: z.enum(["sync", "backfill"]).default("sync"),
  // Reads and counts, writes nothing: how many people the sheet adds.
  dryRun: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        name: z.string().max(300).default(""),
        email: z.string().max(320).default(""),
        mobile: z.string().max(100).default(""),
        classes: z.string().max(4000).default(""),
        // The sheet's "Latest Class Date" (YYYY-MM-DD): where the year walk
        // of the class list starts.
        latestClassDate: z.string().max(40).default(""),
        // The optional "Source" column: what the student says brought them.
        source: z.string().max(100).default(""),
      }),
    )
    .max(MAX_ROWS),
});
export type SheetRow = z.infer<typeof syncBodySchema>["rows"][number];

// ---- Labels (pure) -------------------------------------------------------------

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

export type ParsedLabel = {
  raw: string;
  labelNorm: string;
  hrdc: boolean;
  day: number;
  month: number; // 1-12
};

// "N8N: 11-12 Nov (HRDC)" → the start day and month. A label with no date
// ("LEADERS Club") is not a class and returns null.
export function parseLabel(raw: string): ParsedLabel | null {
  const text = raw.trim();
  if (!text || text === "..." || text.endsWith("…")) return null;
  const dayFirst = new RegExp(
    `(?<!\\d)(\\d{1,2})\\s*(?:-\\s*\\d{1,2})?\\s*${MONTH_RE}(?![a-z])`,
    "i",
  ).exec(text);
  const monthFirst = new RegExp(
    `(?<![a-z])${MONTH_RE}\\.?\\s*(\\d{1,2})(?!\\d)`,
    "i",
  ).exec(text);
  let day: number;
  let monthWord: string;
  if (dayFirst) {
    day = Number(dayFirst[1]);
    monthWord = dayFirst[2];
  } else if (monthFirst) {
    day = Number(monthFirst[2]);
    monthWord = monthFirst[1];
  } else return null;
  const month = MONTHS.indexOf(monthWord.toLowerCase().slice(0, 3)) + 1;
  if (month < 1 || day < 1 || day > 31) return null;
  return {
    raw: text,
    labelNorm: text
      .toLowerCase()
      .replace(/\(\s*hrdc\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    hrdc: /\(\s*hrdc\s*\)/i.test(text),
    day,
    month,
  };
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type DatedLabel = ParsedLabel & { classDate: string };

// The sheet lists a person's classes newest first and writes no year, so the
// year is walked down the list: it starts at the row's latest class date, and
// drops by one whenever a label would otherwise fall after the one above it
// ("Oct 25-26" under "Jan 10-11" is the October before). A label with no
// date is skipped and does not move the walk.
export function datedLabels(
  cell: string,
  latestClassDate: string,
): DatedLabel[] {
  const parsedLatest = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latestClassDate.trim());
  const refYear = parsedLatest
    ? Number(parsedLatest[1])
    : new Date().getUTCFullYear();
  let ref = parsedLatest ? latestClassDate.trim() : iso(refYear, 12, 31);
  const out: DatedLabel[] = [];
  for (const part of cell.split(",")) {
    const label = parseLabel(part);
    if (!label) continue;
    let year = Number(ref.slice(0, 4));
    if (iso(year, label.month, label.day) > ref) year -= 1;
    const classDate = iso(year, label.month, label.day);
    out.push({ ...label, classDate });
    ref = classDate;
  }
  return out;
}

export type ClassFact = {
  id: string;
  start_date: string; // YYYY-MM-DD
  course_name: string;
  code: string;
};

// A month as written in a label or a code: "oct", "sept", "november".
const MONTH_WORDS = new Set([
  ...MONTHS,
  "sept",
  ..."january february march april june july august september october november december".split(
    " ",
  ),
]);

// Words every course shares, which tell none of them apart.
const SKIP_WORDS = new Set([
  "the",
  "and",
  "for",
  "ai",
  "certification",
  "professional",
  "workshop",
  "masterclass",
  "online",
  "class",
  "chi",
  "eng",
  "chinese",
  "english",
  "hrdc",
]);
// What the sheet calls a course, where it is not a word of the CRM's name.
const ALIASES: Record<string, string[]> = {
  n8n: ["automation", "agentic"],
  vibe: ["vibe"],
  fullstack: ["full", "stack"],
  os: ["agents", "foundation"],
};

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // Dates are no course word: every class on the day shares them.
    .filter(
      (w) =>
        w.length >= 2 &&
        !SKIP_WORDS.has(w) &&
        !/^\d+$/.test(w) &&
        !MONTH_WORDS.has(w),
    );

// The CRM class a label is for, or null. A class starting on that exact date
// is the match when only one does; when several start the same day, the
// course name has to share a word with the label ("N8N" reads as Automation).
// Two that still fit are left for a person (`participants:map`).
export function matchClass(
  label: DatedLabel,
  classes: ClassFact[],
): string | null {
  const sameDay = classes.filter((c) => c.start_date === label.classDate);
  if (sameDay.length === 1) return sameDay[0].id;
  if (sameDay.length === 0) return null;
  const mine = new Set(
    words(label.labelNorm).flatMap((w) => [w, ...(ALIASES[w] ?? [])]),
  );
  const fits = sameDay.filter((c) =>
    words(`${c.course_name} ${c.code}`).some((w) => mine.has(w)),
  );
  return fits.length === 1 ? fits[0].id : null;
}

// ---- Contact (pure) ------------------------------------------------------------

export function readPhone(raw: string): {
  text: string | null;
  e164: string | null;
} {
  // "016-3317277 (correct number)": drop the bracketed note before reading.
  const text = raw.replace(/\([^)]*\)/g, "").trim();
  if (!text) return { text: null, e164: null };
  // The sheet often writes a foreign number with its country code and no
  // "+" ("65 93887553"), which a Malaysian default cannot read.
  const digits = text.replace(/\D/g, "");
  const e164 =
    normalizePhoneE164(text) ??
    (digits.length >= 8 ? normalizePhoneE164(`+${digits}`) : null);
  return { text, e164 };
}

const SOURCES: [RegExp, string][] = [
  [/whats?app/i, "whatsapp_ad"],
  [/facebook|^fb|instagram|^ig|meta/i, "facebook_ad"],
  [/referr|friend|introduc|朋友/i, "referral"],
  [/return|alumni|old student|previous/i, "returning_student"],
  [/google/i, "google"],
];
// The "Source" column in the sheet: a self-reported answer, never credited
// to a specific ad. Anything not recognised is kept as "other".
export function readSource(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  for (const [re, slug] of SOURCES) if (re.test(text)) return slug;
  return "other";
}

type Prepared = {
  name: string;
  email: string | null;
  emailNorm: string | null;
  phone: string | null;
  phoneE164: string | null;
  source: string | null;
  labels: DatedLabel[];
};

export function prepareRow(row: SheetRow): Prepared | "no_contact" | "no_name" {
  const name = row.name.replace(/\s+/g, " ").trim();
  if (!name) return "no_name";
  const email = isValidEmail(row.email.trim()) ? row.email.trim() : null;
  const phone = readPhone(row.mobile);
  if (!email && !phone.text) return "no_contact";
  return {
    name,
    email,
    emailNorm: email ? normalizeEmail(email) : null,
    phone: phone.text,
    phoneE164: phone.e164,
    source: readSource(row.source),
    labels: datedLabels(row.classes, row.latestClassDate),
  };
}

// ---- Sync ----------------------------------------------------------------------

export type SyncResult = {
  rows: number;
  skipped: { noContact: number; noName: number };
  matchedPeople: number;
  newPeople: number;
  newEntries: number;
  knownEntries: number;
  // New or known entries for a class the person holds no CRM seat in: people
  // the CRM did not have in that class.
  sheetOnly: number;
  unmappedLabels: number;
  undatedLabels: number;
};

type SyncInput = {
  rows: SheetRow[];
  mode: "sync" | "backfill";
  dryRun: boolean;
};

// Noon in Kuala Lumpur (UTC+8, no DST) on a class date: the stand-in signup
// date of a backfilled row.
const backfillAt = (classDate: string) => `${classDate}T04:00:00Z`;

export async function syncParticipants(input: SyncInput): Promise<SyncResult> {
  const result: SyncResult = {
    rows: input.rows.length,
    skipped: { noContact: 0, noName: 0 },
    matchedPeople: 0,
    newPeople: 0,
    newEntries: 0,
    knownEntries: 0,
    sheetOnly: 0,
    unmappedLabels: 0,
    undatedLabels: 0,
  };
  const prepared: Prepared[] = [];
  for (const row of input.rows) {
    const p = prepareRow(row);
    if (p === "no_contact") result.skipped.noContact += 1;
    else if (p === "no_name") result.skipped.noName += 1;
    else {
      result.undatedLabels += row.classes
        .split(",")
        .filter((s) => s.trim() && !parseLabel(s)).length;
      prepared.push(p);
    }
  }
  if (prepared.length === 0) return result;
  const sql = db();

  // People already in the CRM, one read. A merged-away person is not a match:
  // the survivor holds the email and phone.
  const emails = [
    ...new Set(prepared.flatMap((p) => (p.emailNorm ? [p.emailNorm] : []))),
  ];
  const phones = [
    ...new Set(prepared.flatMap((p) => (p.phoneE164 ? [p.phoneE164] : []))),
  ];
  const found = await sql`
    SELECT id, email_norm, phone_e164 FROM person
    WHERE deleted_at IS NULL AND merged_into_id IS NULL
      AND (email_norm = ANY(${emails}::text[]) OR phone_e164 = ANY(${phones}::text[]))`;
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const f of found) {
    if (f.email_norm) byEmail.set(f.email_norm, f.id);
    if (f.phone_e164) byPhone.set(f.phone_e164, f.id);
  }
  const personFor = (p: Prepared) =>
    (p.emailNorm && byEmail.get(p.emailNorm)) ||
    (p.phoneE164 && byPhone.get(p.phoneE164)) ||
    null;

  // Class labels: the stored mapping first (a person's manual choice always
  // wins), then the automatic match for anything new or still unmatched.
  const labelKeys = new Map<string, DatedLabel>();
  for (const p of prepared)
    for (const l of p.labels) labelKeys.set(`${l.labelNorm}|${l.classDate}`, l);
  const stored = new Map<string, { class_id: string | null; source: string }>();
  if (labelKeys.size > 0) {
    const have = await sql`
      SELECT label_norm, class_date::text AS class_date, class_id, source
      FROM participant_class_label
      WHERE label_norm = ANY(${[...new Set([...labelKeys.values()].map((l) => l.labelNorm))]}::text[])`;
    for (const r of have)
      stored.set(`${r.label_norm}|${r.class_date}`, r as never);
  }
  const classes = labelKeys.size
    ? ((await sql`
        SELECT k.id::text AS id, to_char(k.start_date, 'YYYY-MM-DD') AS start_date,
               co.name_en AS course_name, k.code
        FROM class k JOIN course co ON co.id = k.course_id
        WHERE k.status <> 'cancelled'`) as unknown as ClassFact[])
    : [];
  const classOf = new Map<string, string | null>();
  const labelWrites: { l: DatedLabel; classId: string | null }[] = [];
  for (const [key, l] of labelKeys) {
    const have = stored.get(key);
    if (have && (have.source === "manual" || have.class_id)) {
      classOf.set(key, have.class_id);
      continue;
    }
    const matched = matchClass(l, classes);
    classOf.set(key, matched);
    // New, or an unmatched label that now has a class.
    if (!have || matched) labelWrites.push({ l, classId: matched });
  }
  result.unmappedLabels = [...classOf.values()].filter((c) => !c).length;

  // Entries the CRM already holds, and seats it already has, for the people
  // found above.
  const knownIds = [...new Set(prepared.flatMap((p) => personFor(p) ?? []))];
  const knownEntries = new Set<string>();
  const seats = new Set<string>();
  if (knownIds.length > 0) {
    for (const e of await sql`
      SELECT person_id, label_norm, class_date::text AS class_date
      FROM participant_entry WHERE person_id = ANY(${knownIds}::uuid[])`)
      knownEntries.add(`${e.person_id}|${e.label_norm}|${e.class_date}`);
    for (const s of await sql`
      SELECT person_id, class_id FROM enrolment
      WHERE person_id = ANY(${knownIds}::uuid[])
        AND status IN ('reserved','payment_pending','confirmed','onboarded','attended','completed')`)
      seats.add(`${s.person_id}|${s.class_id}`);
  }

  if (!input.dryRun && labelWrites.length > 0) {
    for (const w of labelWrites)
      await sql`
        INSERT INTO participant_class_label (label_norm, class_date, raw_label, class_id, source)
        VALUES (${w.l.labelNorm}, ${w.l.classDate}, ${w.l.raw}, ${w.classId}, 'auto')
        ON CONFLICT (label_norm, class_date) DO UPDATE
          SET class_id = ${w.classId}, updated_at = now()
          WHERE participant_class_label.source = 'auto'
            AND participant_class_label.class_id IS NULL`;
  }

  const newRows: {
    person_id: string;
    label_norm: string;
    class_date: string;
    hrdc: boolean;
    first_seen_at: string | null;
    approx_date: boolean;
  }[] = [];

  for (const p of prepared) {
    let personId = personFor(p);
    const isNew = personId === null;
    if (isNew) {
      result.newPeople += 1;
      if (!input.dryRun) {
        const made = await createPerson(p);
        personId = made.id;
        // The next row for the same person finds them.
        if (p.emailNorm) byEmail.set(p.emailNorm, made.id);
        if (p.phoneE164) byPhone.set(p.phoneE164, made.id);
      }
    } else result.matchedPeople += 1;

    for (const l of p.labels) {
      const key = `${l.labelNorm}|${l.classDate}`;
      const entryKey = `${personId}|${key}`;
      if (!isNew && knownEntries.has(entryKey)) result.knownEntries += 1;
      else {
        result.newEntries += 1;
        if (personId)
          newRows.push({
            person_id: personId,
            label_norm: l.labelNorm,
            class_date: l.classDate,
            hrdc: l.hrdc,
            first_seen_at:
              input.mode === "backfill" ? backfillAt(l.classDate) : null,
            approx_date: input.mode === "backfill",
          });
      }
      const classId = classOf.get(key) ?? null;
      if (classId && (isNew || !seats.has(`${personId}|${classId}`)))
        result.sheetOnly += 1;
    }

    if (!input.dryRun && !isNew && personId && p.source)
      await recordSource(personId, p.source);
  }

  if (!input.dryRun && newRows.length > 0)
    for (let i = 0; i < newRows.length; i += 200)
      await sql`
        INSERT INTO participant_entry
          ${sql(
            newRows.slice(i, i + 200).map((r) => ({
              ...r,
              first_seen_at: r.first_seen_at ?? new Date().toISOString(),
            })),
          )}
        ON CONFLICT DO NOTHING`;
  return result;
}

// A new person from the sheet. A hard match (same email or phone) is the
// person; a soft match still creates, flagged for review with a duplicate
// task (§12.2), as the help form and the WhatsApp import do. Records where
// the person came from, for PDPA.
async function createPerson(p: Prepared): Promise<{ id: string }> {
  return withTransaction(async () => {
    const sql = db();
    // Two chunks, or a chunk and the next hourly run, never make two people.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`participants:${p.emailNorm ?? p.phoneE164 ?? p.name}`}))`;
    const candidate = {
      fullName: p.name,
      emailNorm: p.emailNorm,
      phoneE164: p.phoneE164,
      companyNorm: null,
    };
    const dup = findDuplicate(
      candidate,
      await dedupeCandidates(candidate, null),
    );
    if (dup.kind === "hard") return { id: dup.match.id };
    const reason =
      p.phone && !p.phoneE164
        ? "phone_unnormalised"
        : dup.kind === "soft"
          ? `possible_duplicate_${dup.on}`
          : null;
    const [row] = await sql`
      INSERT INTO person (full_name, email, phone, phone_e164, whatsapp_e164,
                          needs_review, needs_review_reason)
      VALUES (${p.name}, ${p.email}, ${p.phone}, ${p.phoneE164}, ${p.phoneE164},
              ${reason !== null}, ${reason})
      RETURNING id`;
    if (dup.kind === "soft")
      await raiseDuplicateTask(
        row.id,
        { id: dup.match.id, fullName: dup.match.fullName },
        null,
      );
    await writeAudit({
      userId: null,
      action: "create",
      entity: "person",
      entityId: row.id,
      before: null,
      after: { source: "participant_sheet" },
    });
    // Where they came from, and the person's first touch if they have none.
    // A source of "none" says only that the sheet is the origin: it carries no
    // utm fields, so the report reads it as "no source recorded".
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM touchpoint WHERE person_id = ${row.id}`;
    await sql`
      INSERT INTO touchpoint (person_id, channel, utm_source, form_name,
                              is_first_touch, external_ref)
      VALUES (${row.id}, 'import', ${p.source ? `self:${p.source}` : null},
              'participant-sheet', ${n === 0}, ${`sheet:${row.id}`})
      ON CONFLICT DO NOTHING`;
    return { id: row.id as string };
  });
}

// A source the sheet gives for a person already in the CRM. One sheet
// touchpoint per person; touchpoints are append-only, so a later answer does
// not replace the first.
async function recordSource(personId: string, source: string): Promise<void> {
  await db()`
    INSERT INTO touchpoint (person_id, channel, utm_source, form_name,
                            is_first_touch, external_ref)
    VALUES (${personId}, 'import', ${`self:${source}`}, 'participant-sheet',
            false, ${`sheet:${personId}`})
    ON CONFLICT DO NOTHING`;
}
