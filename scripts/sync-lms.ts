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
// A seat staff added by hand is adopted the same way, but never cut over.
// A participant whose email already exists in the CRM maps to that person,
// which is left untouched.
//
// ponytail: polls and diffs the whole LMS every cycle (hundreds of rows).
// Switch to a Supabase Realtime / LISTEN trigger on the LMS if it grows.
import { createHash } from "node:crypto";
import postgres from "postgres";
import { normalizePhoneE164 } from "../lib/format/phone.ts";
import { lmsFundingType, seatSyncKey } from "../lib/import/lms-funding.ts";
import { ROOM_SEATS } from "../lib/classes/types.ts";
import {
  adoptEnrolment,
  classIdForCohort,
  syncClassStatus,
  cohortsOnCancelledClass,
  cancelCutOver,
  cutOverCancels,
  goneSeatCancels,
  MAX_GONE_CANCELS,
  GONE_REASON,
  GONE_TASK_REASON,
  importSeatsByKey,
  seatsToAdopt,
  type Cohort,
  type MarkedSeat,
  type ImportClass,
  type ImportSeat,
} from "../lib/import/lms-adopt.ts";
import {
  IMPORT_CLASS_NOTE,
  SYNC_LOCK_KEY,
  enrolmentIdFor,
  isNoSeats,
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
    // With `refused`, a chunk the seat trigger refuses (no_seats) is retried row
    // by row; each refused row goes to `refused` instead of failing the sync.
    const upsert = async (
      table: string,
      rows: Record<string, unknown>[],
      conflict: string,
      update: string[],
      refused?: (row: Record<string, unknown>) => void,
    ) => {
      const write = (s: postgres.TransactionSql, r: Record<string, unknown>[]) =>
        s`INSERT INTO ${s(table)} ${s(r)} ON CONFLICT (${s(conflict)}) DO UPDATE SET ${s(
          Object.fromEntries(
            update.map((c) => [c, s`EXCLUDED.${s(c)}`]),
          ) as never,
        )}`;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        if (!refused) {
          await write(tx, chunk);
          continue;
        }
        try {
          await tx.savepoint((s) => write(s, chunk));
        } catch (e) {
          if (!isNoSeats(e)) throw e;
          for (const row of chunk)
            try {
              await tx.savepoint((s) => write(s, [row]));
            } catch (e) {
              if (!isNoSeats(e)) throw e;
              refused(row);
            }
        }
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
      tx`SELECT id, code, start_date::text, end_date::text, language, status FROM class`,
    );
    // Classes the CRM made (SalesProcess import or by hand): any of them may be
    // the class an LMS cohort stands for. Not ones that are an LMS cohort
    // themselves, nor ones already linked to a cohort that is gone.
    const cohortIds = src.cohorts.map((k) => k.id as string);
    const importClasses = await tx<ImportClass[]>`
      SELECT id, code, course_id, start_date::text AS start_date, language, status,
             coalesce(notes LIKE ${IMPORT_CLASS_NOTE + "%"}, false) AS guessed_language
      FROM class
      WHERE id <> ALL(${cohortIds})
        AND (lms_cohort_id IS NULL OR lms_cohort_id = ANY(${cohortIds}))`;
    const linked = new Map(
      (
        await tx`SELECT id, lms_cohort_id FROM class WHERE lms_cohort_id IS NOT NULL`
      ).map((r) => [r.lms_cohort_id as string, r.id as string]),
    );
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
        classIdForCohort(k, crmClassIds, importClasses, cohorts, warnings, linked),
      ]),
    );
    const lmsClassIds = new Set(classOf.values());
    const onCancelled = cohortsOnCancelledClass(classOf, importClasses);
    const ownedClassIds = new Set(
      [...classOf].filter(([k]) => !onCancelled.has(k)).map(([, id]) => id),
    );
    // A wrongly parsed SalesProcess date (or a typo by hand) leaves a CRM class beside the real cohort.
    for (const c of importClasses) {
      if (lmsClassIds.has(c.id) || c.status === "cancelled") continue;
      for (const k of cohorts) {
        const gap =
          Math.abs(Date.parse(k.start_date) - Date.parse(c.start_date)) /
          86400000;
        if (k.course_id === c.course_id && gap >= 1 && gap <= 7)
          warnings.push(
            `CRM class ${c.code} starts ${c.start_date}, LMS cohort ${k.slug} of the same course starts ${k.start_date}: check the date`,
          );
      }
    }
    const classes: Record<string, unknown>[] = [];
    const toComplete: string[] = [];
    for (const [i, k] of src.cohorts.entries()) {
      const cancelled = onCancelled.get(k.id);
      if (cancelled) {
        warnings.push(`class cancelled in CRM: ${cancelled.code}`);
        continue;
      }
      const completed = day(k.end_date) < today;
      if (completed) done.add(k.id);
      const online = /online/i.test(k.slug);
      const lang = cohorts[i].language;
      const classId = classOf.get(k.id)!;
      const seen = haveClass.get(classId);
      // [code, start, end, language, status]; status is the CRM's own (§12.1).
      const was = seen ? (JSON.parse(seen) as string[]) : null;
      const status = syncClassStatus(was?.[4] ?? null, completed);
      if (was && status) toComplete.push(classId);
      if (
        was &&
        !status &&
        JSON.stringify(was.slice(0, 4)) ===
          JSON.stringify([k.slug, day(k.start_date), day(k.end_date), lang])
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
        capacity: Math.max(seats.get(k.id) ?? 1, completed ? 1 : ROOM_SEATS),
        price_myr: k.price_cents != null ? k.price_cents / 100 : null,
        status: status ?? "open", // used on insert only; never in the update list

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
    ]);
    // Guarded again in SQL: staff may have changed the status since the read.
    if (toComplete.length)
      await tx`UPDATE class SET status = 'completed'
        WHERE id = ANY(${toComplete}) AND status IN ('open','few_seats','full')`;
    // Save the LMS cohort id on every class linked this run (a no-op once saved),
    // for the CRM → LMS sender. A clash is a warning, not a failed sync.
    if (classOf.size)
      try {
        const saved = await tx.savepoint(
          (s) => s`
            UPDATE class c SET lms_cohort_id = m.lms
            FROM unnest(${[...classOf.values()]}::uuid[], ${[...classOf.keys()]}::uuid[]) AS m(crm, lms)
            WHERE c.id = m.crm AND c.lms_cohort_id IS DISTINCT FROM m.lms
            RETURNING c.id`,
        );
        saved.forEach(() => bump("class: LMS id saved", "update"));
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
        warnings.push(`LMS class ids not saved, two CRM classes claim one LMS cohort: ${(err as Error).message}`);
      }

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
    // The value side must follow seatSyncKey's order (lib/import/lms-funding.ts).
    const haveEnrol = await existing(
      tx`SELECT id, funding_type FROM enrolment`,
    );
    const active = new Map(
      (
        await tx`SELECT id, person_id, class_id FROM enrolment WHERE status NOT IN ('cancelled','refunded','transferred')`
      ).map((r) => [`${r.person_id}|${r.class_id}`, r.id]),
    );
    const cohortEnd = new Map(src.cohorts.map((k) => [k.id, k.end_date]));
    // Enrolments the SalesProcess import made.
    const importEnrols = await tx<ImportSeat[]>`
      SELECT id, person_id, class_id, status FROM enrolment
      WHERE id = ANY(${(
        await tx`SELECT DISTINCT order_id FROM salesprocess_payment WHERE order_id IS NOT NULL`
      ).map((r) => enrolmentIdFor(r.order_id))})`;
    // Seats an LMS enrollment adopts: the import's, plus ones staff added by hand.
    const adoptable = await seatsToAdopt(tx, importEnrols.map((e) => e.id), src.enrols.map((e) => e.id));
    const importOf = importSeatsByKey(adoptable);
    const adoptById = new Map(adoptable.map((s) => [s.id, s]));
    // CRM seats that carry the LMS's seat id (028): matched on it before
    // person+class, so a seat the CRM made is never made a second time.
    const marked = await tx<MarkedSeat[]>`
      SELECT id, lms_enrollment_id, class_id, status FROM enrolment WHERE lms_enrollment_id IS NOT NULL`;
    const crmIdOf = new Map(marked.map((s) => [s.lms_enrollment_id, s.id]));
    const marks: [crm: string, lms: string][] = [];
    const matched = new Set<string>();
    const adopt: { id: string; status: string; completed_at: Date }[] = [];
    // Funding for seats the LMS adopts (import and hand-added seats keep their
    // own ids), and LMS values the CRM doesn't know, counted for one warning.
    const adoptFunding: { id: string; funding: string }[] = [];
    const unknownFunding = new Map<string, number>();
    const enrols: Record<string, unknown>[] = [];
    for (const e of src.enrols) {
      if (onCancelled.has(e.cohort_id)) continue;
      const { funding, unknown } = lmsFundingType(e.funding_type);
      if (unknown)
        unknownFunding.set(unknown, (unknownFunding.get(unknown) ?? 0) + 1);
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
      const markedId = crmIdOf.get(e.id);
      const mine = haveEnrol.has(e.id)
        ? undefined
        : markedId
          ? adoptById.get(markedId)
          : importOf.get(key);
      if (mine) {
        const d = adoptEnrolment(
          mine,
          finished ? cohortEnd.get(e.cohort_id) : null,
          matched,
        );
        if (d.action === "skip-refunded") {
          bump("enrolment: refunded in SalesProcess", "same");
          continue;
        }
        if (!matched.has(d.id)) marks.push([d.id, e.id]);
        matched.add(d.id);
        if (d.action === "update") adopt.push(d);
        // An empty LMS value never clears what staff set on the seat.
        if (funding) adoptFunding.push({ id: d.id, funding });
        bump("enrolment: adopted", d.action);
        continue;
      }
      const id = markedId ?? e.id;
      const holder = active.get(key);
      if (holder && holder !== id) {
        warnings.push(
          `enrollment ${e.id}: person already enrolled in class (enrolment ${holder})`,
        );
        continue;
      }
      active.set(key, id);
      marks.push([id, e.id]);
      // Matched to the LMS this run, so the cut-over below never cancels it.
      matched.add(id);
      const seen = haveEnrol.get(id);
      if (seen === seatSyncKey(funding)) {
        bump("enrolment", "same");
        continue;
      }
      enrols.push({
        id,
        person_id: personId,
        class_id: classId,
        status: finished ? "completed" : "confirmed",
        payer_type: e.funding_type === "hrdc" ? "company" : "self",
        // Every LMS seat has amount_paid_cents 0: that is "no price", not RM 0.
        // Insert only; the price on an existing seat is the CRM's (Shawn, 16 Nov).
        price_paid_myr: e.amount_paid_cents ? e.amount_paid_cents / 100 : null,
        funding_type: funding,
        completed_at: finished ? cohortEnd.get(e.cohort_id) : null,
        created_at: e.created_at,
      });
      bump("enrolment", seen ? "update" : "insert");
    }
    // From the day after the class start (Kuala Lumpur) the LMS owns the seats.
    // Cut over first, so the seats it frees are there for the LMS inserts below.
    const [{ kl_today }] =
      await tx`SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS kl_today`;
    const classStarts = new Map(
      (
        await tx`SELECT id, start_date::text AS start FROM class WHERE id = ANY(${[...ownedClassIds]})`
      ).map((r) => [r.id as string, r.start as string]),
    );
    const cut = cutOverCancels(importEnrols, ownedClassIds, matched, classStarts, kl_today);
    const cutDone = await cancelCutOver(tx, cut);
    cutDone.forEach(() => bump("enrolment: cut over", "update"));

    // A full class refuses the seat (no_seats): skip that row, not the whole sync.
    const codeOf = new Map(src.cohorts.map((k) => [classOf.get(k.id), k.slug]));
    await upsert("enrolment", enrols, "id", ["funding_type"], (row) => {
      stats.enrolment[haveEnrol.has(row.id as string) ? "update" : "insert"]--;
      bump("enrolment: class full", "same");
      warnings.push(`enrolment refused, class full: ${codeOf.get(row.class_id as string) ?? "(unknown class)"}`);
    });
    for (const a of adopt)
      await tx`UPDATE enrolment SET status = ${a.status}, completed_at = ${a.completed_at} WHERE id = ${a.id} AND status = 'confirmed'`;
    for (const f of adoptFunding) {
      const changed = await tx`
        UPDATE enrolment SET funding_type = ${f.funding}
        WHERE id = ${f.id} AND funding_type IS DISTINCT FROM ${f.funding}
        RETURNING id`;
      bump("enrolment: adopted funding", changed.length ? "update" : "same");
    }
    // Save the LMS seat id on every seat matched this run (a no-op once saved).
    // A clash with another seat's id is a warning, not a failed sync.
    if (marks.length)
      try {
        const saved = await tx.savepoint(
          (s) => s`
            UPDATE enrolment e SET lms_enrollment_id = m.lms
            FROM unnest(${marks.map((m) => m[0])}::uuid[], ${marks.map((m) => m[1])}::uuid[]) AS m(crm, lms)
            WHERE e.id = m.crm AND e.lms_enrollment_id IS DISTINCT FROM m.lms
            RETURNING e.id`,
        );
        saved.forEach(() => bump("enrolment: LMS id saved", "update"));
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
        warnings.push(`LMS seat ids not saved, two CRM seats claim one LMS seat: ${(err as Error).message}`);
      }
    // Seats the LMS removed, judged on the seats marked before this run.
    const gone = goneSeatCancels(marked, new Set(src.enrols.map((e) => e.id as string)), ownedClassIds);
    if (gone.held) {
      warnings.push(gone.held);
      // One Ops task, not just a line in the Actions log (Shawn, #88). Keyed on
      // the held seats, so the same set raises one task however many nights it
      // stays; an empty LMS read raises one a day.
      const heldIds = [...gone.heldIds].sort();
      const key = heldIds.length
        ? `lms-gone:${createHash("sha1").update(heldIds.join(",")).digest("hex").slice(0, 16)}`
        : `lms-gone:empty:${kl_today}`;
      const where = [
        ...new Set(
          marked
            .filter((s) => heldIds.includes(s.id))
            .map((s) => codeOf.get(s.class_id) ?? s.class_id),
        ),
      ].join(", ");
      const notes = heldIds.length
        ? `${heldIds.length} seats (${where}) are no longer in the LMS. The sync cancels at most ${MAX_GONE_CANCELS} at once, so it cancelled none. Check each one in the LMS and cancel the seats that were really removed.`
        : "The LMS returned no seats at all, so the sync cancelled none. Check the LMS is up.";
      // Assignee: the duty super_admin, same rule as dutySuperAdmin().
      const raised = await tx`
        INSERT INTO task (type, title, assigned_user_id, due_at, notes, source_key)
        VALUES ('other', 'Check seats removed from the LMS',
                (SELECT id FROM app_user WHERE role_code = 'super_admin' AND is_active
                 ORDER BY created_at, id LIMIT 1),
                now(), ${notes}, ${key})
        ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
        RETURNING id`;
      bump("task: check LMS removals", raised.length ? "insert" : "same");
    }
    const goneDone = await cancelCutOver(tx, gone.cancel, GONE_REASON, GONE_TASK_REASON);
    goneDone.forEach(() => bump("enrolment: gone from LMS", "update"));
    for (const [value, n] of unknownFunding)
      warnings.push(
        `funding_type "${value}" is not a CRM value, left empty on ${n} seat(s); widen enrolment_funding_type_check to keep it`,
      );

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
