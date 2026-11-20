// The participant sheet sync against a database (migration 026): people are
// matched or created, an entry is written once, backfill rows are dated by
// the class, and the weekly report counts a sheet row only where the CRM has
// no seat for that person and class. Each test rolls back. Skipped when
// DATABASE_URL isn't set. Point it at a local or test database only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { weeklySummary } from "../lib/reports/weekly.ts";
import { syncParticipants, type SheetRow } from "../lib/sync/participants.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { adsReportQuerySchema } from "../lib/validation/report.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const uid = () => crypto.randomUUID().slice(0, 12);
const TODAY = new Date().toISOString().slice(0, 10);
const RANGE = adsReportQuerySchema.parse({
  from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
  to: TODAY,
});

async function newClass(startDate: string): Promise<string> {
  const [co] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES (${uid()}, 'Sheet course', 'workshop', 1, 900) RETURNING id`;
  const [cl] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, price_myr, status)
    VALUES (${co.id}, ${uid()}, ${startDate}::date, ${startDate}::date, 'en',
            'online', 'https://lead.test/c', 50, 900, 'open')
    RETURNING id`;
  return cl.id;
}

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  name: "Sheet Person",
  email: `${uid()}@sheet.test`,
  mobile: "",
  classes: "",
  latestClassDate: "",
  source: "",
  ...over,
});

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const labelFor = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `Sheet Course: ${d.getUTCDate()} ${month}`;
};

it("creates a person once, writes the entry once, and a repeat adds nothing", async () => {
  const date = day(10);
  await newClass(date);
  const r = row({ classes: labelFor(date), latestClassDate: date });

  const first = await syncParticipants({
    rows: [r],
    mode: "sync",
    dryRun: false,
  });
  assert.equal(first.newPeople, 1);
  assert.equal(first.newEntries, 1);

  const again = await syncParticipants({
    rows: [r],
    mode: "sync",
    dryRun: false,
  });
  assert.deepEqual(
    {
      people: again.newPeople,
      matched: again.matchedPeople,
      entries: again.newEntries,
      known: again.knownEntries,
    },
    { people: 0, matched: 1, entries: 0, known: 1 },
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM person WHERE email_norm = ${r.email.toLowerCase()}`;
  assert.equal(n, 1);
});

it("a dry run writes nothing", async () => {
  const date = day(10);
  await newClass(date);
  const r = row({ classes: labelFor(date), latestClassDate: date });
  const res = await syncParticipants({ rows: [r], mode: "sync", dryRun: true });
  assert.deepEqual(
    {
      people: res.newPeople,
      entries: res.newEntries,
      sheetOnly: res.sheetOnly,
    },
    { people: 1, entries: 1, sheetOnly: 1 },
  );
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM person WHERE email_norm = ${r.email.toLowerCase()}`;
  assert.equal(n, 0);
});

it("a person already in the CRM is matched by email, not created again", async () => {
  const date = day(10);
  await newClass(date);
  const r = row({ classes: labelFor(date), latestClassDate: date });
  await db()`INSERT INTO person (full_name, email) VALUES ('Existing', ${r.email})`;
  const res = await syncParticipants({
    rows: [r],
    mode: "sync",
    dryRun: false,
  });
  assert.deepEqual(
    { people: res.newPeople, matched: res.matchedPeople },
    { people: 0, matched: 1 },
  );
});

it("backfill dates the entry by its class and flags it approximate", async () => {
  const date = day(-100);
  await newClass(date);
  const r = row({ classes: labelFor(date), latestClassDate: date });
  await syncParticipants({ rows: [r], mode: "backfill", dryRun: false });
  const [e] = await db()`
    SELECT approx_date, first_seen_at::date::text AS seen
    FROM participant_entry ORDER BY first_seen_at DESC LIMIT 1`;
  assert.deepEqual(
    { approx: e.approx_date, seen: e.seen },
    { approx: true, seen: date },
  );
});

it("the report counts a sheet signup, and not one the CRM already holds a seat for", async () => {
  const date = day(10);
  const cls = await newClass(date);
  const only = row({ classes: labelFor(date), latestClassDate: date });
  const both = row({ classes: labelFor(date), latestClassDate: date });
  await syncParticipants({ rows: [only, both], mode: "sync", dryRun: false });
  const [p] =
    await db()`SELECT id FROM person WHERE email_norm = ${both.email.toLowerCase()}`;
  await db()`
    INSERT INTO enrolment (person_id, class_id, status) VALUES (${p.id}, ${cls}, 'confirmed')`;

  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Sheet reader', 'marketing') RETURNING id`;
  const s = await weeklySummary({ id: u.id, role: "marketing" }, RANGE);
  const klass = s.classes.find((c) => c.key === cls);
  // One signup is the confirmed seat, one is the sheet-only person.
  assert.equal(klass?.signups, 2);
  assert.equal(s.sources.sheet >= 1, true);
});

it("a label with no class is listed, then counted once someone maps it", async () => {
  const date = day(10);
  const r = row({ classes: labelFor(date), latestClassDate: date });
  const res = await syncParticipants({
    rows: [r],
    mode: "sync",
    dryRun: false,
  });
  assert.equal(res.unmappedLabels, 1);
  const cls = await newClass(date);
  await db()`
    UPDATE participant_class_label SET class_id = ${cls}, source = 'manual'
    WHERE class_date = ${date}::date AND class_id IS NULL`;
  const again = await syncParticipants({
    rows: [r],
    mode: "sync",
    dryRun: false,
  });
  assert.equal(again.unmappedLabels, 0);
});

it("a Source typed in after the first sync is recorded, dated before the signup", async () => {
  const date = day(10);
  await newClass(date);
  const r = row({ classes: labelFor(date), latestClassDate: date });
  // First sync: the sheet's Source column is still empty.
  await syncParticipants({ rows: [r], mode: "sync", dryRun: false });
  // Later Ops fill it in.
  await syncParticipants({
    rows: [{ ...r, source: "Referral" }],
    mode: "sync",
    dryRun: false,
  });
  const rows = await db()`
    SELECT t.utm_source, t.occurred_at <= e.first_seen_at AS before_signup
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    JOIN participant_entry e ON e.person_id = p.id
    WHERE p.email_norm = ${r.email.toLowerCase()}
      AND t.form_name = 'participant-sheet' AND t.utm_source LIKE 'self:%'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].before_signup, true);
});
