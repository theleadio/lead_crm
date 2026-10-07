// Spec §9.11 status change, §12.4 state machine, §12.1 seats, §11.1 events:
// what one accepted move writes, and that a refused one writes nothing.
import { after } from "node:test";
import assert from "node:assert/strict";
import { changeEnrolmentStatus } from "../lib/enrolments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newUser } from "./seed.ts";

after(closeDb);

const statusOf = async (id: string) => {
  const [r] = await db()`SELECT * FROM enrolment WHERE id = ${id}`;
  return r;
};

const events = async (enrolmentId: string, type?: string) => {
  const sql = db();
  return sql`
    SELECT type, payload FROM event_outbox
    WHERE aggregate_id = ${enrolmentId}
      ${type ? sql`AND type = ${type}` : sql``}`;
};

const audits = async (enrolmentId: string) =>
  db()`
    SELECT action, before, after FROM audit_log
    WHERE entity = 'enrolment' AND entity_id = ${enrolmentId}`;

it("confirms a waiting enrolment, raising EnrolmentConfirmed (§11.1)", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 10 });
  const id = await enrol(classId, "payment_pending");

  const result = await changeEnrolmentStatus(
    id,
    { toStatus: "confirmed" },
    1,
    viewer,
  );
  assert.equal(result.kind, "ok");
  const row = await statusOf(id);
  assert.equal(row.status, "confirmed");
  assert.equal(Number(row.version), 2);

  const raised = await events(id, "EnrolmentConfirmed");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].payload.enrolmentId, id);
  assert.equal(raised[0].payload.classId, classId);
  assert.ok(raised[0].payload.personId);
  assert.equal(raised[0].payload.language, "en");

  const [audit] = await audits(id);
  assert.equal(audit.before.status, "payment_pending");
  assert.equal(audit.after.status, "confirmed");
});

// §12.4: any transition not on the diagram is a 422 that writes nothing.
it("refuses a move that is not on the §12.4 diagram", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const id = await enrol(classId, "reserved");

  const result = await changeEnrolmentStatus(
    id,
    { toStatus: "completed" },
    1,
    viewer,
  );
  assert.equal(result.kind, "illegal_transition");
  const row = await statusOf(id);
  assert.equal(row.status, "reserved");
  assert.equal(Number(row.version), 1);
  assert.equal((await events(id)).length, 0);
  assert.equal((await audits(id)).length, 0);
});

it("records the reason on a cancel and raises EnrolmentCancelled", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const id = await enrol(classId, "confirmed");

  const result = await changeEnrolmentStatus(
    id,
    { toStatus: "cancelled", reason: "Student withdrew" },
    1,
    viewer,
  );
  assert.equal(result.kind, "ok");
  const row = await statusOf(id);
  assert.equal(row.status, "cancelled");
  assert.equal(row.cancelled_reason, "Student withdrew");

  const raised = await events(id, "EnrolmentCancelled");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].payload.reason, "Student withdrew");
  const [audit] = await audits(id);
  assert.equal(audit.after.reason, "Student withdrew");
});

// §5 refuses a completed row with no date, so the service sets it.
it("sets completed_at and invents no certificate number", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const id = await enrol(classId, "onboarded");
  assert.equal(
    (await changeEnrolmentStatus(id, { toStatus: "attended" }, 1, viewer)).kind,
    "ok",
  );
  assert.equal(
    (await changeEnrolmentStatus(id, { toStatus: "completed" }, 2, viewer))
      .kind,
    "ok",
  );

  const row = await statusOf(id);
  assert.equal(row.status, "completed");
  assert.ok(row.completed_at, "completed_at is set");
  assert.equal(row.certificate_no, null);
  // §11.1 names no event for attended or completed.
  assert.equal((await events(id)).length, 0);
});

it("is 409 stale when the version is behind, writing nothing", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  const id = await enrol(classId, "reserved");
  await db()`UPDATE enrolment SET payer_type = 'company' WHERE id = ${id}`;

  const result = await changeEnrolmentStatus(
    id,
    { toStatus: "confirmed" },
    1,
    viewer,
  );
  assert.equal(result.kind, "stale");
  assert.equal((await statusOf(id)).status, "reserved");
  assert.equal((await events(id)).length, 0);
});

// §12.1: a move that starts holding a seat is a fresh claim on one.
it("refuses a seat-claiming move on a full class", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  await enrol(classId, "confirmed");
  const waiting = await enrol(classId, "waitlisted");

  const result = await changeEnrolmentStatus(
    waiting,
    { toStatus: "reserved" },
    1,
    viewer,
  );
  assert.equal(result.kind, "no_seats");
  assert.equal((await statusOf(waiting)).status, "waitlisted");
});

// §12.1: moving between two seat-holding statuses changes no seat count.
it("allows confirmed → onboarded on a full class", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  const id = await enrol(classId, "confirmed");

  const result = await changeEnrolmentStatus(
    id,
    { toStatus: "onboarded" },
    1,
    viewer,
  );
  assert.equal(result.kind, "ok");
  assert.equal((await statusOf(id)).status, "onboarded");
});

// §12.1, §12.11: the class row belongs to the database's triggers.
it("writes no class row, leaving the status to the database", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  const id = await enrol(classId, "confirmed");
  const [{ status: fullStatus, version: before }] =
    await db()`SELECT status, version FROM class WHERE id = ${classId}`;
  assert.equal(fullStatus, "full", "the trigger made it full");

  await changeEnrolmentStatus(
    id,
    { toStatus: "cancelled", reason: "Student withdrew" },
    1,
    viewer,
  );
  const [cls] =
    await db()`SELECT status, version FROM class WHERE id = ${classId}`;
  // §12.1: one free seat of one is at the few-seats threshold, so the trigger
  // chose few_seats. Whatever it chose, the app did not choose it.
  assert.equal(cls.status, "few_seats", "the trigger reopened it, not the app");
  // One bump, from the trigger's own update — not a second write by the app.
  assert.equal(Number(cls.version), Number(before) + 1);
});

// §6 enrolment row: only super_admin and operations write, and the denial is
// audited by the route's `forbidden` helper.
it("refuses the roles that may not change an enrolment", async () => {
  const classId = await newClass();
  const id = await enrol(classId, "reserved");
  for (const role of [
    "management",
    "sales",
    "support",
    "marketing",
    "part_time",
  ] as const) {
    const result = await changeEnrolmentStatus(
      id,
      { toStatus: "confirmed" },
      1,
      await newUser(role),
    );
    assert.equal(result.kind, "forbidden", role);
  }
  assert.equal((await statusOf(id)).status, "reserved");
});

it("is not_found for an unknown or malformed id", async () => {
  const viewer = await newUser();
  assert.equal(
    (
      await changeEnrolmentStatus(
        "not-an-id",
        { toStatus: "confirmed" },
        1,
        viewer,
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (
      await changeEnrolmentStatus(
        crypto.randomUUID(),
        { toStatus: "confirmed" },
        1,
        viewer,
      )
    ).kind,
    "not_found",
  );
});
