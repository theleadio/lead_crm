// The committed-data cleanup helper must bypass the append-only history
// trigger but never FK checks: purging an enrolment something still points at
// fails loudly. Committed rows, cleaned up in finally (audit_log rows are
// never deleted). Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { purgeEnrolments } from "./support/purge.ts";

after(closeDb);

const skip = !process.env.DATABASE_URL && "no DATABASE_URL";

test(
  "purgeEnrolments: an enrolment a payment references is refused with a foreign-key error",
  { skip },
  async () => {
    const sql = db();
    const tag = crypto.randomUUID();
    let courseId: string | undefined;
    let classId: string | undefined;
    let personId: string | undefined;
    let enrolmentId: string | undefined;
    let paymentId: string | undefined;
    try {
      [{ id: courseId }] = await sql`
        INSERT INTO course (code, name_en, track, duration_days)
        VALUES (${`PURGE-${tag}`}, 'Purge test', 'workshop', 1) RETURNING id`;
      [{ id: classId }] = await sql`
        INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                           online_url, capacity, few_seats_threshold, status)
        VALUES (${courseId!}, ${`PURGE-${tag}`}, current_date + 30, current_date + 31,
                'en', 'online', 'https://example.test/x', 5, 1, 'open')
        RETURNING id`;
      [{ id: personId }] = await sql`
        INSERT INTO person (full_name) VALUES (${`PURGE ${tag}`}) RETURNING id`;
      [{ id: enrolmentId }] = await sql`
        INSERT INTO enrolment (person_id, class_id, status)
        VALUES (${personId!}, ${classId!}, 'confirmed') RETURNING id`;
      // Migration 009's trigger has already written the history row.
      [{ id: paymentId }] = await sql`
        INSERT INTO payment (enrolment_id, method, status, amount_myr)
        VALUES (${enrolmentId!}, 'stripe_card', 'pending', 100) RETURNING id`;

      await assert.rejects(purgeEnrolments([enrolmentId!]), {
        code: "23503",
      });
      // The whole purge rolled back: enrolment and its history are still there.
      const [n] = await sql`
        SELECT (SELECT count(*)::int FROM enrolment WHERE id = ${enrolmentId!}) AS e,
               (SELECT count(*)::int FROM enrolment_status_history
                WHERE enrolment_id = ${enrolmentId!}) AS h`;
      assert.deepEqual({ e: n.e, h: n.h }, { e: 1, h: 1 });
    } finally {
      if (paymentId) await sql`DELETE FROM payment WHERE id = ${paymentId}`;
      if (enrolmentId) await purgeEnrolments([enrolmentId]);
      if (classId) await sql`DELETE FROM class WHERE id = ${classId}`;
      if (courseId) await sql`DELETE FROM course WHERE id = ${courseId}`;
      if (personId) await sql`DELETE FROM person WHERE id = ${personId}`;
    }
  },
);
