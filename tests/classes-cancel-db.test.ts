// Spec §9.10 Cancel class, §11.1 ClassCancelled, §12.1 seats: one
// transaction takes the class, the seats it was holding and its pending
// notice, and nothing is written when the cancel is refused.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cancelClass, updateClass } from "../lib/classes/service.ts";
import { ROLES, type Role, type Viewer } from "../lib/auth/permissions.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { classCancelSchema } from "../lib/validation/class-cancel.ts";
import { classUpdateSchema } from "../lib/validation/class.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const reason = classCancelSchema.parse({ reason: "Trainer unavailable" });

async function newUser(role: Role = "operations"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newClass(
  status = "open",
  startsInDays = 14,
): Promise<{ id: string; version: number }> {
  const [course] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       venue_name, venue_address, city, capacity, status,
                       is_public)
    VALUES (${course.id}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${startsInDays}::int,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${startsInDays}::int,
            'en', 'in_person', 'LEAD Training Centre', '1 Jalan Test',
            'Kuala Lumpur', 20, ${status}, true)
    RETURNING id, version`;
  return { id: c.id as string, version: Number(c.version) };
}

async function enrol(
  classId: string,
  status: string,
  opts: { reservedOffset?: string; transferredTo?: string } = {},
): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Test person') RETURNING id`;
  const [e] = await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until,
                           completed_at, transferred_to_enrolment_id,
                           cancelled_reason)
    VALUES (${p.id}, ${classId}, ${status},
            now() + ${opts.reservedOffset ?? null}::interval,
            ${status === "completed" ? new Date() : null},
            ${opts.transferredTo ?? null},
            ${status === "cancelled" ? "changed_mind" : null})
    RETURNING id`;
  return e.id as string;
}

const classRow = async (id: string) =>
  (await db()`SELECT * FROM class WHERE id = ${id}`)[0];
const enrolment = async (id: string) =>
  (await db()`SELECT * FROM enrolment WHERE id = ${id}`)[0];
const events = async (id: string, type: string) =>
  db()`SELECT * FROM event_outbox WHERE aggregate_id = ${id} AND type = ${type}`;
const audits = async (id: string) =>
  db()`SELECT * FROM audit_log WHERE entity = 'class' AND entity_id = ${id}
       ORDER BY created_at`;

it("cancels the class, its seat-holders, its notice, and raises one event", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  const confirmed = await enrol(cls.id, "confirmed");
  const pending = await enrol(cls.id, "payment_pending");
  const reserved = await enrol(cls.id, "reserved", {
    reservedOffset: "2 days",
  });
  // A pending notice from a 9.9 edit: nobody needs it now.
  const edit = await updateClass(
    cls.id,
    classUpdateSchema.parse({ venueName: "Another venue" }),
    cls.version,
    "prepare",
    viewer,
  );
  assert.equal(edit.kind, "ok");
  const version = (edit as { version: number }).version;

  const result = await cancelClass(cls.id, reason, version, viewer);
  assert.equal(result.kind, "cancelled", JSON.stringify(result));
  assert.equal((result as { enrolmentCount: number }).enrolmentCount, 3);

  assert.equal((await classRow(cls.id)).status, "cancelled");
  for (const id of [confirmed, pending, reserved]) {
    const e = await enrolment(id);
    assert.equal(e.status, "cancelled");
    assert.equal(e.cancelled_reason, "class_cancelled");
  }

  const [notice] = await db()`
    SELECT status FROM class_notice WHERE class_id = ${cls.id}`;
  assert.equal(notice.status, "discarded");

  const raised = await events(cls.id, "ClassCancelled");
  assert.equal(raised.length, 1);
  const payload = raised[0].payload as {
    classId: string;
    reason: string;
    enrolmentIds: string[];
  };
  assert.equal(payload.classId, cls.id);
  assert.equal(payload.reason, "Trainer unavailable");
  assert.deepEqual(
    [...payload.enrolmentIds].sort(),
    [confirmed, pending, reserved].sort(),
  );

  // §11.1: and one EnrolmentCancelled per seat freed, so the enrolment-level
  // consumers see the cancellation too.
  for (const id of [confirmed, pending, reserved]) {
    const [event] = await events(id, "EnrolmentCancelled");
    assert.deepEqual(event.payload, {
      enrolmentId: id,
      reason: "class_cancelled",
    });
  }

  const audit = (await audits(cls.id)).at(-1);
  assert.equal(
    (audit?.after as { reason: string }).reason,
    "Trainer unavailable",
  );
  assert.equal(
    (audit?.after as { enrolments_cancelled: number }).enrolments_cancelled,
    3,
  );
});

it("leaves the enrolments that were never holding a seat alone", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  const target = await newClass();
  const confirmed = await enrol(cls.id, "confirmed");
  const already = await enrol(cls.id, "cancelled");
  const refunded = await enrol(cls.id, "refunded");
  const noShow = await enrol(cls.id, "no_show");
  const waitlisted = await enrol(cls.id, "waitlisted");
  const expired = await enrol(cls.id, "reserved", {
    reservedOffset: "-1 hour",
  });
  const movedTo = await enrol(target.id, "confirmed");
  const transferred = await enrol(cls.id, "transferred", {
    transferredTo: movedTo,
  });

  const result = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(result.kind, "cancelled");
  assert.equal((result as { enrolmentCount: number }).enrolmentCount, 1);

  // The one seat-holder moved; everything else kept its own status, and the
  // row that was cancelled earlier kept its own reason.
  assert.equal((await enrolment(confirmed)).status, "cancelled");
  assert.equal((await enrolment(already)).cancelled_reason, "changed_mind");
  assert.equal((await enrolment(refunded)).status, "refunded");
  assert.equal((await enrolment(noShow)).status, "no_show");
  assert.equal((await enrolment(waitlisted)).status, "waitlisted");
  assert.equal((await enrolment(transferred)).status, "transferred");
  // An expired reservation holds no seat (§12.1), so the cancel skips it.
  assert.equal((await enrolment(expired)).status, "reserved");

  const payload = (await events(cls.id, "ClassCancelled"))[0].payload as {
    enrolmentIds: string[];
  };
  assert.deepEqual(payload.enrolmentIds, [confirmed]);
  // The rows that were already history get no event of their own.
  assert.equal((await events(confirmed, "EnrolmentCancelled")).length, 1);
  for (const id of [already, refunded, noShow, waitlisted, expired])
    assert.equal((await events(id, "EnrolmentCancelled")).length, 0);
});

// Shawn, 6 Oct: cancelling a class that already ran used to rewrite its
// attended and completed students to cancelled. Both halves of the rule:
// the date, and anyone marked as having sat it.
it("a class with a completed student is not cancelled", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  const completed = await enrol(cls.id, "completed");
  const confirmed = await enrol(cls.id, "confirmed");

  const result = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(result.kind, "class_started");
  assert.equal((result as { past: number }).past, 1);

  // Nothing moved: not the class, not the student who sat it, not the one who
  // is still waiting.
  assert.equal((await classRow(cls.id)).status, "open");
  assert.equal((await enrolment(completed)).status, "completed");
  assert.equal((await enrolment(confirmed)).status, "confirmed");
  assert.equal((await events(cls.id, "ClassCancelled")).length, 0);
  assert.equal((await events(confirmed, "EnrolmentCancelled")).length, 0);
  assert.equal((await audits(cls.id)).length, 0);
});

it("a class that has started is not cancelled either", async () => {
  const viewer = await newUser();
  // Today in Kuala Lumpur counts as started (§4).
  const cls = await newClass("open", 0);
  const confirmed = await enrol(cls.id, "confirmed");

  const result = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(result.kind, "class_started");
  assert.equal((result as { past: number }).past, 0);
  assert.equal((await classRow(cls.id)).status, "open");
  assert.equal((await enrolment(confirmed)).status, "confirmed");
  assert.equal((await events(cls.id, "ClassCancelled")).length, 0);
});

it("an onboarded student is cancelled with the class", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  const onboarded = await enrol(cls.id, "onboarded");

  const result = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(result.kind, "cancelled");
  assert.equal((result as { enrolmentCount: number }).enrolmentCount, 1);
  assert.equal((await enrolment(onboarded)).status, "cancelled");
  assert.equal(
    (await enrolment(onboarded)).cancelled_reason,
    "class_cancelled",
  );
  assert.equal((await events(onboarded, "EnrolmentCancelled")).length, 1);
});

it("a stale version changes nothing at all", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  const confirmed = await enrol(cls.id, "confirmed");
  const edit = await updateClass(
    cls.id,
    classUpdateSchema.parse({ venueName: "Moved" }),
    cls.version,
    "prepare",
    viewer,
  );
  assert.equal(edit.kind, "ok");

  // The version the screen was holding before that edit.
  const result = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(result.kind, "stale");
  assert.notEqual((await classRow(cls.id)).status, "cancelled");
  assert.equal((await enrolment(confirmed)).status, "confirmed");
  assert.equal((await events(cls.id, "ClassCancelled")).length, 0);
  const [notice] = await db()`
    SELECT status FROM class_notice WHERE class_id = ${cls.id}`;
  assert.equal(notice.status, "pending");
});

it("an already cancelled class is refused and raises no second event", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  await enrol(cls.id, "confirmed");
  const first = await cancelClass(cls.id, reason, cls.version, viewer);
  assert.equal(first.kind, "cancelled");
  const version = (first as { version: number }).version;

  const second = await cancelClass(cls.id, reason, version, viewer);
  assert.equal(second.kind, "already_cancelled");
  assert.equal((await events(cls.id, "ClassCancelled")).length, 1);
});

it("only super_admin and operations cancel a class", async () => {
  for (const role of ROLES) {
    const viewer = await newUser(role);
    const cls = await newClass();
    const confirmed = await enrol(cls.id, "confirmed");
    const result = await cancelClass(cls.id, reason, cls.version, viewer);
    if (role === "super_admin" || role === "operations") {
      assert.equal(result.kind, "cancelled", role);
    } else {
      assert.equal(result.kind, "forbidden", role);
      assert.equal((await classRow(cls.id)).status, "open");
      assert.equal((await enrolment(confirmed)).status, "confirmed");
      assert.equal((await events(cls.id, "ClassCancelled")).length, 0);
    }
  }
});

it("an unknown class is not found", async () => {
  const viewer = await newUser();
  assert.equal(
    (
      await cancelClass(
        "00000000-0000-0000-0000-000000000000",
        reason,
        1,
        viewer,
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (await cancelClass("not-a-uuid", reason, 1, viewer)).kind,
    "not_found",
  );
});
