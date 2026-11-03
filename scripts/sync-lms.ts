// LMS → CRM sync. Reads the LMS database (SELECT only, read-only
// transaction) and upserts course, class, person and enrolment into the CRM.
//
//   npm run lms:sync                  dry run: print what would change
//   npm run lms:sync -- --apply       write once
//   npm run lms:sync -- --apply --watch[=60]   repeat every N seconds
//
// Needs DATABASE_URL (CRM) and LMS_DATABASE_URL. Idempotent: CRM course,
// class and enrolment ids are the LMS ids, so a re-run updates in place.
// Exception: a class or enrolment the SalesProcess import made is adopted and
// keeps its own id; from the class start date the LMS decides who has a seat.
// A participant whose email already exists in the CRM maps to that person,
// which is left untouched.
//
// ponytail: polls and diffs the whole LMS every cycle (hundreds of rows).
// Switch to a Supabase Realtime / LISTEN trigger on the LMS if it grows.
import postgres from "postgres";
import { normalizePhoneE164 } from "../lib/format/phone.ts";
import {
  classIdForCohort,
  cutOverCancels,
  type Cohort,
  type ImportClass,
} from "../lib/import/lms-adopt.ts";
import {
  IMPORT_CLASS_NOTE,
  SYNC_LOCK_KEY,
  enrolmentIdFor,
} from "../lib/import/salesprocess-enrolments.ts";

const apply = process.argv.includes("--apply");
const watchArg = process.argv.find((a) => a.startsWith("--watch"));
const everySec = watchArg ? Number(watchArg.split("=")[1] ?? 60) : 0;

const need = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`${k} is not set (run with --env-file=.env.local).`);
    process.exit(1);
  }
  return v;
};
const open = (url: string) =>
  postgres(url, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
const lms = open(need("LMS_DATABASE_URL"));
const crm = open(need("DATABASE_URL"));

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const day = (d: Date) => d.toISOString().slice(0, 10);
const today = day(new Date());

type Stats = Record<string, { insert: number; update: number; same: number }>;

async function once() {
  // Read side: one read-only transaction so a mid-sync LMS write can't tear the snapshot.
  const src = await lms.begin("read only", async (tx) => ({
    courses: await tx`SELECT * FROM courses`,
    cohorts: await tx`SELECT * FROM cohorts`,
    people: await tx`SELECT * FROM participants`,
    enrols: await tx`SELECT * FROM enrollments`,
  }));

  const stats: Stats = {};
  const bump = (t: string, k: "insert" | "update" | "same") => {
    (stats[t] ??= { insert: 0, update: 0, same: 0 })[k]++;
  };
  const warnings: string[] = [];

  const run = async (tx: postgres.TransactionSql) => {
    await tx`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;
    // One bulk read per table, then one bulk write per table: the CRM is a
    // remote DB, a query per row takes minutes.
    const ids = (r: { id: string }[]) => new Set(r.map((x) => x.id));
    // Rows already in the CRM, by id: unchanged ones are counted and skipped so
    // a --watch cycle does not bump updated_at/version on every row.
    const existing = async (q: Promise<Record<string, unknown>[]>) =>
      new Map(
        (await q).map((r) => [
          r.id as string,
          JSON.stringify(Object.values(r).slice(1)),
        ]),
      );
    const upsert = async (
      table: string,
      rows: Record<string, unknown>[],
      conflict: string,
      update: string[],
    ) => {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await tx`INSERT INTO ${tx(table)} ${tx(chunk)} ON CONFLICT (${tx(conflict)}) DO UPDATE SET ${tx(
          Object.fromEntries(
            update.map((c) => [c, tx`EXCLUDED.${tx(c)}`]),
          ) as never,
        )}`;
      }
    };

    // course. CRM requires track + duration_days; LMS has neither, so use
    // track from the name (Certification / Mastery, else workshop) and the span
    // of its longest cohort; fix by hand in the CRM if wrong.
    const spans = new Map<string, number>();
    for (const c of src.cohorts) {
      const n = Math.round((+c.end_date - +c.start_date) / 86400000) + 1;
      spans.set(c.course_id, Math.max(spans.get(c.course_id) ?? 1, n));
    }
    const haveCourse = await existing(
      tx`SELECT id, name_en, name_zh, list_price_myr::float8, is_active FROM course`,
    );
    const usedCode = new Set(
      (await tx`SELECT code FROM course`).map((r) => r.code),
    );
    const courses: Record<string, unknown>[] = [];
    for (const c of src.courses) {
      let code = `lms-${slug(c.name)}`.slice(0, 60);
      while (usedCode.has(code) && !haveCourse.has(c.id)) code += "-x";
      usedCode.add(code);
      const seen = haveCourse.get(c.id);
      // Every LMS course has price_cents = 0, so taking the LMS figure
      // literally wrote NULL over whatever the CRM held and wiped the prices
      // someone had entered from the published course pages. A price the LMS
      // does not have is not a price of nothing: the CRM keeps its own until
      // the LMS carries one, and a real LMS figure still wins.
      const crmPrice = seen
        ? ((
            JSON.parse(seen) as [string, string | null, number | null, boolean]
          )[2] ?? null)
        : null;
      const price = c.price_cents ? c.price_cents / 100 : crmPrice;
      if (seen === JSON.stringify([c.name, c.name_cn, price, c.is_active])) {
        bump("course", "same");
        continue;
      }
      bump("course", seen ? "update" : "insert");
      courses.push({
        id: c.id,
        code,
        name_en: c.name,
        name_zh: c.name_cn,
        track: /certification/i.test(c.name)
          ? "certification"
          : /mastery/i.test(c.name)
            ? "mastery"
            : "workshop",
        duration_days: spans.get(c.id) ?? 1,
        list_price_myr: price,
        is_active: c.is_active,
      });
    }
    await upsert("course", courses, "id", [
      "name_en",
      "name_zh",
      "list_price_myr",
      "is_active",
    ]);

    // class. Venue, capacity and mode are not in the LMS: online if the slug says so,
    // else in_person at AI365 Hub (address/city TBC). Capacity: 40 for a class still
    // to run, enrolments seen for one already run (min 1 either way).
    const seats = new Map<string, number>();
    for (const e of src.enrols)
      seats.set(e.cohort_id, (seats.get(e.cohort_id) ?? 0) + 1);
    const done = new Set<string>();
    const haveClass = await existing(
      tx`SELECT id, code, start_date::text, end_date::text, language, (status = 'completed') FROM class`,
    );
    const importClasses = await tx<ImportClass[]>`
      SELECT id, code, course_id, start_date::text AS start_date, language FROM class
      WHERE notes LIKE ${IMPORT_CLASS_NOTE + "%"}`;
    const cohorts: Cohort[] = src.cohorts.map((k) => ({
      id: k.id,
      slug: k.slug,
      course_id: k.course_id,
      start_date: day(k.start_date),
      language: k.language === "cn" || k.language === "zh" ? "zh" : "en",
    }));
    const crmClassIds = new Set(haveClass.keys());
    const classOf = new Map(
      cohorts.map((k) => [
        k.id,
        classIdForCohort(k, crmClassIds, importClasses, cohorts, warnings),
      ]),
    );
    const lmsClassIds = new Set(classOf.values());
    // A wrongly parsed SalesProcess date leaves an import class beside the real cohort.
    for (const c of importClasses) {
      if (lmsClassIds.has(c.id)) continue;
      for (const k of cohorts) {
        const gap =
          Math.abs(Date.parse(k.start_date) - Date.parse(c.start_date)) /
          86400000;
        if (k.course_id === c.course_id && gap >= 1 && gap <= 7)
          warnings.push(
            `SalesProcess class ${c.code} starts ${c.start_date}, LMS cohort ${k.slug} of the same course starts ${k.start_date}: check the date`,
          );
      }
    }
    const classes: Record<string, unknown>[] = [];
    for (const [i, k] of src.cohorts.entries()) {
      const completed = day(k.end_date) < today;
      if (completed) done.add(k.id);
      const online = /online/i.test(k.slug);
      const lang = cohorts[i].language;
      const status = completed ? "completed" : "open";
      const classId = classOf.get(k.id)!;
      const seen = haveClass.get(classId);
      if (
        seen ===
        JSON.stringify([
          k.slug,
          day(k.start_date),
          day(k.end_date),
          lang,
          completed,
        ])
      ) {
        bump("class", "same");
        continue;
      }
      bump("class", seen ? "update" : "insert");
      classes.push({
        id: classId,
        course_id: k.course_id,
        code: k.slug,
        start_date: day(k.start_date),
        end_date: day(k.end_date),
        language: lang,
        mode: online ? "online" : "in_person",
        venue_name: online ? null : "AI365 Hub",
        venue_address: online ? null : "TBC",
        city: online ? null : "TBC",
        online_url: online ? (k.board_url ?? "https://thelead.io") : null,
        capacity: Math.max(seats.get(k.id) ?? 1, completed ? 1 : 40),
        price_myr: k.price_cents != null ? k.price_cents / 100 : null,
        status,
        notes: online
          ? "Imported from LMS."
          : "Imported from LMS. Venue address and city still TBC.",
      });
    }
    await upsert("class", classes, "id", [
      "code",
      "start_date",
      "end_date",
      "language",
      "status",
    ]);

    // person: match by email first (never overwrite an existing CRM person).
    const byId = ids(await tx`SELECT id FROM person`);
    const byEmail = new Map(
      (
        await tx`SELECT id, email_norm FROM person WHERE email_norm IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL`
      ).map((r) => [r.email_norm, r.id]),
    );
    const phones = new Set(
      (
        await tx`SELECT phone_e164 FROM person WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL`
      ).map((r) => r.phone_e164),
    );
    const personOf = new Map<string, string>();
    const fresh: Record<string, unknown>[] = [];
    for (const p of src.people) {
      const email = p.email.trim();
      const existing = byId.has(p.id) ? p.id : byEmail.get(email.toLowerCase());
      if (existing) {
        personOf.set(p.id, existing);
        bump("person", "same");
        continue;
      }
      let e164 = p.phone ? normalizePhoneE164(p.phone) : null;
      let reason: string | null =
        p.phone && !e164 ? "phone_unnormalised" : null;
      if (e164 && phones.has(e164)) {
        e164 = null;
        reason = "possible_duplicate_phone";
      }
      if (e164) phones.add(e164);
      byEmail.set(email.toLowerCase(), p.id);
      fresh.push({
        id: p.id,
        full_name: p.full_name.trim() || "(no name)",
        email,
        phone: p.phone,
        phone_e164: e164,
        company_name_given: p.company?.slice(0, 200) ?? null,
        needs_review: reason !== null,
        needs_review_reason: reason,
      });
      personOf.set(p.id, p.id);
      bump("person", "insert");
    }
    for (let i = 0; i < fresh.length; i += 200)
      await tx`INSERT INTO person ${tx(fresh.slice(i, i + 200))}`;

    // enrolment. Two LMS rows for one person+class would collide with the CRM's
    // active-enrolment index: keep the first, warn about the rest.
    const haveEnrol = await existing(
      tx`SELECT id, price_paid_myr::float8 FROM enrolment`,
    );
    const active = new Map(
      (
        await tx`SELECT id, person_id, class_id FROM enrolment WHERE status NOT IN ('cancelled','refunded','transferred')`
      ).map((r) => [`${r.person_id}|${r.class_id}`, r.id]),
    );
    const cohortEnd = new Map(src.cohorts.map((k) => [k.id, k.end_date]));
    // Enrolments the SalesProcess import made, by person|class; an active one wins over a refunded one.
    const importEnrols = await tx<
      { id: string; person_id: string; class_id: string; status: string }[]
    >`
      SELECT id, person_id, class_id, status FROM enrolment
      WHERE id = ANY(${(
        await tx`SELECT DISTINCT order_id FROM salesprocess_payment WHERE order_id IS NOT NULL`
      ).map((r) => enrolmentIdFor(r.order_id))})`;
    const importOf = new Map<string, { id: string; status: string }>();
    for (const r of importEnrols) {
      const key = `${r.person_id}|${r.class_id}`;
      if (!["cancelled", "refunded", "transferred"].includes(r.status))
        importOf.set(key, { id: r.id, status: r.status });
      else if (r.status === "refunded" && !importOf.has(key))
        importOf.set(key, { id: r.id, status: r.status });
    }
    const matched = new Set<string>();
    const adopt: { id: string; status: string; completed_at: Date | null }[] = [];
    const enrols: Record<string, unknown>[] = [];
    for (const e of src.enrols) {
      const personId = personOf.get(e.participant_id);
      if (!personId) {
        warnings.push(
          `enrollment ${e.id}: participant ${e.participant_id} missing`,
        );
        continue;
      }
      const classId = classOf.get(e.cohort_id) ?? e.cohort_id;
      const key = `${personId}|${classId}`;
      const finished = done.has(e.cohort_id);
      const mine = haveEnrol.has(e.id) ? undefined : importOf.get(key);
      if (mine) {
        importOf.delete(key);
        // A SalesProcess refund wins: the seat does not come back while Ops catches up in the LMS.
        if (mine.status === "refunded") {
          bump("enrolment: refunded in SalesProcess", "same");
          continue;
        }
        matched.add(mine.id);
        const status = finished ? "completed" : "confirmed";
        // Only the two statuses the sync sets are moved; a status staff set stays.
        if (mine.status === status || !["confirmed", "completed"].includes(mine.status)) {
          bump("enrolment: adopted", "same");
          continue;
        }
        adopt.push({
          id: mine.id,
          status,
          completed_at: finished ? cohortEnd.get(e.cohort_id) : null,
        });
        bump("enrolment: adopted", "update");
        continue;
      }
      const holder = active.get(key);
      if (holder && holder !== e.id) {
        warnings.push(
          `enrollment ${e.id}: person already enrolled in class (enrolment ${holder})`,
        );
        continue;
      }
      active.set(key, e.id);
      const seen = haveEnrol.get(e.id);
      if (seen === JSON.stringify([e.amount_paid_cents / 100])) {
        bump("enrolment", "same");
        continue;
      }
      enrols.push({
        id: e.id,
        person_id: personId,
        class_id: classId,
        status: finished ? "completed" : "confirmed",
        payer_type: e.funding_type === "hrdc" ? "company" : "self",
        price_paid_myr: e.amount_paid_cents / 100,
        completed_at: finished ? cohortEnd.get(e.cohort_id) : null,
        created_at: e.created_at,
      });
      bump("enrolment", seen ? "update" : "insert");
    }
    await upsert("enrolment", enrols, "id", ["price_paid_myr"]);
    for (const a of adopt)
      await tx`UPDATE enrolment SET status = ${a.status}, completed_at = ${a.completed_at} WHERE id = ${a.id}`;

    // From the class start date (Kuala Lumpur) the LMS owns the seats.
    const started = ids(
      await tx`SELECT id FROM class WHERE id = ANY(${[...lmsClassIds]})
        AND start_date <= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`,
    );
    const cut = cutOverCancels(importEnrols, lmsClassIds, matched, started);
    if (cut.length)
      await tx`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'Not in the LMS at class start' WHERE id = ANY(${cut})`;
    for (const _ of cut) bump("enrolment: cut over", "update");

    if (!apply) throw new Error("dry-run"); // roll back
  };

  try {
    await crm.begin(run);
  } catch (err) {
    if (!(err instanceof Error && err.message === "dry-run")) throw err;
  }

  console.log(
    `${new Date().toISOString()} ${apply ? "APPLIED" : "DRY RUN (rolled back)"}`,
  );
  console.table(stats);
  for (const w of warnings) console.warn("warn:", w);
  console.log(
    `lms sync: ${apply ? "applied" : "dry run"} ${JSON.stringify(stats)}, ${warnings.length} warnings`,
  );
}

try {
  if (!everySec) await once();
  else
    for (;;) {
      try {
        await once();
      } catch (err) {
        console.error(
          "sync failed, retrying next cycle:",
          err instanceof Error ? err.message : err,
        );
      }
      await new Promise((r) => setTimeout(r, everySec * 1000));
    }
} finally {
  await lms.end();
  await crm.end();
}
