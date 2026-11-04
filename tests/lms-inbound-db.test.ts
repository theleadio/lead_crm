// LMS → CRM attendance and completion (lib/lms/receive.ts, handoff §4.6),
// against the database. Each test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { processLmsEvent, verifyLmsSignature } from "../lib/lms/receive.ts";
import { signLmsBody } from "../lib/lms/send.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse } from "./seed.ts";

after(closeDb);

const NOW = 1_800_000_000;

test("signature: the CRM's own scheme, 5-minute window, exact match only", () => {
  const body = '{"messageId":"m1"}';
  const sig = signLmsBody(body, "s3cret", NOW);
  assert.equal(verifyLmsSignature(body, String(NOW), sig, "s3cret", NOW), true);
  assert.equal(
    verifyLmsSignature(`${body} `, String(NOW), sig, "s3cret", NOW),
    false,
  );
  assert.equal(verifyLmsSignature(body, String(NOW), sig, "other", NOW), false);
  assert.equal(
    verifyLmsSignature(
      body,
      String(NOW - 301),
      signLmsBody(body, "s3cret", NOW - 301),
      "s3cret",
      NOW,
    ),
    false,
  );
  assert.equal(verifyLmsSignature(body, "12abc", sig, "s3cret", NOW), false);
  assert.equal(verifyLmsSignature(body, null, sig, "s3cret", NOW), false);
  assert.equal(verifyLmsSignature(body, String(NOW), sig, "", NOW), false);
});

const msg = (type: string, data: Record<string, unknown>) => ({
  messageId: `lms-${crypto.randomUUID()}`,
  type,
  data,
});

async function confirmedStudent() {
  const classId = await newClass({ courseId: await newCourse() });
  return enrol(classId, "confirmed");
}
const statusOf = async (id: string) =>
  (
    await db()`SELECT status, completed_at, certificate_no FROM enrolment WHERE id = ${id}`
  )[0];

it("onboarded → attended → completed, step by step, with the certificate", async () => {
  const id = await confirmedStudent();
  for (const type of ["enrolment.onboarded", "enrolment.attended"])
    assert.equal(
      (await processLmsEvent(msg(type, { enrolmentId: id }))).kind,
      "applied",
    );
  const r = await processLmsEvent(
    msg("enrolment.completed", {
      enrolmentId: id,
      completedAt: "2026-11-20T10:00:00Z",
      certificateNo: "LEAD-2026-000123",
    }),
  );
  assert.equal(r.kind, "applied");
  const e = await statusOf(id);
  assert.equal(e.status, "completed");
  assert.equal(
    new Date(e.completed_at).toISOString(),
    "2026-11-20T10:00:00.000Z",
  );
  assert.equal(e.certificate_no, "LEAD-2026-000123");
  // The status history trigger (migration 009) recorded every step.
  const steps = (
    await db()`
      SELECT to_status FROM enrolment_status_history
      WHERE enrolment_id = ${id} ORDER BY changed_at`
  ).map((h) => h.to_status);
  assert.deepEqual(steps, ["confirmed", "onboarded", "attended", "completed"]);
});

it("a step that skips ahead is refused as out of order, then runs on retry", async () => {
  const id = await confirmedStudent();
  const completed = msg("enrolment.completed", { enrolmentId: id });
  assert.equal((await processLmsEvent(completed)).kind, "out_of_order");
  assert.equal((await statusOf(id)).status, "confirmed");

  await processLmsEvent(msg("enrolment.onboarded", { enrolmentId: id }));
  await processLmsEvent(msg("enrolment.attended", { enrolmentId: id }));
  // The same message, retried by the LMS, now applies.
  assert.equal((await processLmsEvent(completed)).kind, "applied");
});

it("the same message twice is a duplicate; the same step again changes nothing", async () => {
  const id = await confirmedStudent();
  const m = msg("enrolment.onboarded", { enrolmentId: id });
  await processLmsEvent(m);
  assert.equal((await processLmsEvent(m)).kind, "duplicate");
  assert.equal(
    (await processLmsEvent(msg("enrolment.onboarded", { enrolmentId: id })))
      .kind,
    "duplicate",
  );
});

it("no_show from onboarded; a cancelled student can't be marked attended", async () => {
  const shy = await confirmedStudent();
  await processLmsEvent(msg("enrolment.onboarded", { enrolmentId: shy }));
  assert.equal(
    (await processLmsEvent(msg("enrolment.no_show", { enrolmentId: shy })))
      .kind,
    "applied",
  );
  assert.equal((await statusOf(shy)).status, "no_show");

  const gone = await confirmedStudent();
  await db()`UPDATE enrolment SET status = 'cancelled' WHERE id = ${gone}`;
  assert.equal(
    (await processLmsEvent(msg("enrolment.attended", { enrolmentId: gone })))
      .kind,
    "out_of_order",
  );
});

it("bad data: unknown enrolment, a non-uuid, an unknown type, a certificate already used", async () => {
  assert.equal(
    (
      await processLmsEvent(
        msg("enrolment.onboarded", { enrolmentId: crypto.randomUUID() }),
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (await processLmsEvent(msg("enrolment.onboarded", { enrolmentId: "x" })))
      .kind,
    "invalid",
  );
  assert.equal(
    (await processLmsEvent(msg("enrolment.graduated", {}))).kind,
    "ignored",
  );

  const a = await confirmedStudent();
  const b = await confirmedStudent();
  for (const id of [a, b])
    for (const type of ["enrolment.onboarded", "enrolment.attended"])
      await processLmsEvent(msg(type, { enrolmentId: id }));
  await processLmsEvent(
    msg("enrolment.completed", { enrolmentId: a, certificateNo: "DUP-1" }),
  );
  const r = await processLmsEvent(
    msg("enrolment.completed", { enrolmentId: b, certificateNo: "DUP-1" }),
  );
  assert.equal(r.kind, "invalid");
  assert.equal((await statusOf(b)).status, "attended");
});
