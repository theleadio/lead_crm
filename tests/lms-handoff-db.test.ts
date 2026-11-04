// CRM -> LMS notices against the database: which CRM events queue which
// notice, what each message carries, the on/off switch, and failures. The
// LMS is faked through the sendToLms port. Each test is rolled back.
import { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { drainOutbox } from "../lib/events/drain.ts";
import { makeHandlers } from "../lib/events/handlers.ts";
import { raiseEvent } from "../lib/events/raise.ts";
import type { LmsMessage, LmsSender } from "../lib/lms/send.ts";
import { updatePerson } from "../lib/people/detail-service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newUser } from "./seed.ts";

after(closeDb);

const was = process.env.LMS_HANDOFF_ENABLED;
beforeEach(() => {
  process.env.LMS_HANDOFF_ENABLED = "true";
});
afterEach(() => {
  if (was === undefined) delete process.env.LMS_HANDOFF_ENABLED;
  else process.env.LMS_HANDOFF_ENABLED = was;
});

function fakeLms(fail = false) {
  const sent: LmsMessage[] = [];
  const send: LmsSender = async (m) => {
    if (fail) throw new Error("LMS answered 503 to " + m.type);
    sent.push(m);
    return { status: 200, body: {} };
  };
  return { sent, send };
}

// Drain until nothing more is due (a failed row is pushed out by its backoff).
async function drainAll(send: LmsSender) {
  const handlers = makeHandlers({
    expireCheckoutSession: async () => {},
    sendToLms: send,
  }) as never;
  for (let i = 0; i < 10; i++) {
    const r = await drainOutbox({ handlers });
    if (r.claimed === 0) return;
  }
}

async function student(
  status: string,
  email: string | null | undefined = undefined,
) {
  const classId = await newClass({ courseId: await newCourse() });
  const enrolmentId = await enrol(classId, status);
  const [{ person_id }] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${enrolmentId}`;
  // Unique by default: the CRM refuses two people with one email.
  const mail =
    email === undefined
      ? `s-${crypto.randomUUID().slice(0, 8)}@lead.test`
      : email;
  await db()`UPDATE person SET email = ${mail} WHERE id = ${person_id}`;
  return { classId, enrolmentId, personId: person_id as string };
}

const outboxTypes = async () =>
  (await db()`SELECT type FROM event_outbox ORDER BY seq`).map(
    (r) => r.type as string,
  );

it("EnrolmentConfirmed sends enrolment.confirmed with person, class and course", async () => {
  const s = await student("confirmed");
  await raiseEvent(
    "EnrolmentConfirmed",
    s.enrolmentId,
    {
      enrolmentId: s.enrolmentId,
      personId: s.personId,
      classId: s.classId,
      language: "en",
    },
    null,
  );
  const lms = fakeLms();
  await drainAll(lms.send);

  assert.equal(lms.sent.length, 1);
  const m = lms.sent[0];
  assert.equal(m.type, "enrolment.confirmed");
  const d = m.data as Record<string, Record<string, unknown>>;
  assert.equal(d.enrolment.id, s.enrolmentId);
  assert.match(String(d.person.email), /^s-.*@lead\.test$/);
  assert.equal(d.class.id, s.classId);
  assert.ok(d.course.name);
  // The messageId is the LmsNotice outbox row, so the LMS can ignore repeats.
  const [notice] =
    await db()`SELECT id FROM event_outbox WHERE type = 'LmsNotice'`;
  assert.equal(m.messageId, notice.id);
  // Onboarding starts from this.
  assert.ok((await outboxTypes()).includes("LmsAccountReady"));
});

it("with the switch off, nothing is queued or sent", async () => {
  process.env.LMS_HANDOFF_ENABLED = "";
  const s = await student("confirmed");
  await raiseEvent(
    "EnrolmentConfirmed",
    s.enrolmentId,
    {
      enrolmentId: s.enrolmentId,
      personId: s.personId,
      classId: s.classId,
      language: "en",
    },
    null,
  );
  const lms = fakeLms();
  await drainAll(lms.send);
  assert.equal(lms.sent.length, 0);
  assert.ok(!(await outboxTypes()).includes("LmsNotice"));
});

it("a student with no email isn't sent; Ops get a task instead", async () => {
  await newUser("super_admin");
  const s = await student("confirmed", null);
  await raiseEvent(
    "EnrolmentConfirmed",
    s.enrolmentId,
    {
      enrolmentId: s.enrolmentId,
      personId: s.personId,
      classId: s.classId,
      language: "en",
    },
    null,
  );
  const lms = fakeLms();
  await drainAll(lms.send);
  assert.equal(lms.sent.length, 0);
  const [t] = await db()`
    SELECT title FROM task WHERE enrolment_id = ${s.enrolmentId}`;
  assert.match(t.title, /Add an email/);
  assert.ok(!(await outboxTypes()).includes("LmsAccountReady"));
});

it("an LMS failure leaves the notice to retry, and nothing else is held up", async () => {
  const s = await student("confirmed");
  await raiseEvent(
    "EnrolmentConfirmed",
    s.enrolmentId,
    {
      enrolmentId: s.enrolmentId,
      personId: s.personId,
      classId: s.classId,
      language: "en",
    },
    null,
  );
  await drainAll(fakeLms(true).send);
  const [n] = await db()`
    SELECT attempts, last_error, processed_at FROM event_outbox
    WHERE type = 'LmsNotice'`;
  assert.equal(n.processed_at, null);
  assert.equal(n.attempts, 1);
  assert.match(n.last_error, /503/);
  const [c] = await db()`
    SELECT processed_at FROM event_outbox WHERE type = 'EnrolmentConfirmed'`;
  assert.ok(c.processed_at, "the CRM event itself is done");
});

it("a cancelled enrolment is sent only if it was ever confirmed", async () => {
  const confirmed = await student("confirmed");
  await db()`UPDATE enrolment SET status = 'cancelled' WHERE id = ${confirmed.enrolmentId}`;
  const expired = await student("reserved");
  await db()`UPDATE enrolment SET status = 'cancelled' WHERE id = ${expired.enrolmentId}`;
  for (const [id, reason] of [
    [confirmed.enrolmentId, "student_withdrew"],
    [expired.enrolmentId, "reservation_expired"],
  ])
    await raiseEvent(
      "EnrolmentCancelled",
      id,
      { enrolmentId: id, reason },
      null,
    );

  const lms = fakeLms();
  await drainAll(lms.send);
  assert.deepEqual(
    lms.sent.map((m) => [m.type, m.data.enrolmentId, m.data.reason]),
    [["enrolment.cancelled", confirmed.enrolmentId, "student_withdrew"]],
  );
});

it("ClassChanged sends class.updated with the changed fields", async () => {
  const s = await student("confirmed");
  await raiseEvent(
    "ClassChanged",
    s.classId,
    {
      classId: s.classId,
      changedFields: { venue_name: "New hall" },
      noticeId: null,
    },
    null,
  );
  const lms = fakeLms();
  await drainAll(lms.send);
  assert.equal(lms.sent[0].type, "class.updated");
  assert.deepEqual(lms.sent[0].data.changedFields, { venue_name: "New hall" });
  assert.equal((lms.sent[0].data.class as { id: string }).id, s.classId);
});

it("EnrolmentTransferred sends the new enrolment and class", async () => {
  const s = await student("confirmed");
  const toClass = await newClass({ courseId: await newCourse() });
  const newId = await enrol(toClass, "confirmed", { personId: s.personId });
  await db()`
    UPDATE enrolment SET status = 'transferred', transferred_to_enrolment_id = ${newId}
    WHERE id = ${s.enrolmentId}`;
  await raiseEvent(
    "EnrolmentTransferred",
    s.enrolmentId,
    { enrolmentId: s.enrolmentId, fromClassId: s.classId, toClassId: toClass },
    null,
  );
  const lms = fakeLms();
  await drainAll(lms.send);
  const m = lms.sent.find((x) => x.type === "enrolment.transferred")!;
  assert.equal(m.data.newEnrolmentId, newId);
  assert.equal(m.data.toClassId, toClass);
  assert.equal((m.data.class as { id: string }).id, toClass);
});

it("changing a person's email tells the LMS, with the old email to find them", async () => {
  const admin = await newUser("super_admin");
  const s = await student("confirmed", "old@lead.test");
  const [{ version }] =
    await db()`SELECT version FROM person WHERE id = ${s.personId}`;
  const r = await updatePerson(
    s.personId,
    { email: "new@lead.test" },
    Number(version),
    admin,
  );
  assert.equal(r.kind, "updated");

  const lms = fakeLms();
  await drainAll(lms.send);
  const m = lms.sent.find((x) => x.type === "person.updated")!;
  assert.equal(m.data.previousEmail, "old@lead.test");
  assert.equal(m.data.email, "new@lead.test");
});

it("adding an email to a student the LMS never got sends their live enrolment", async () => {
  const admin = await newUser("super_admin");
  const s = await student("confirmed", null);
  const [{ version }] =
    await db()`SELECT version FROM person WHERE id = ${s.personId}`;
  await updatePerson(
    s.personId,
    { email: "late@lead.test" },
    Number(version),
    admin,
  );

  const lms = fakeLms();
  await drainAll(lms.send);
  assert.deepEqual(
    lms.sent.map((m) => m.type),
    ["enrolment.confirmed"],
  );
  assert.equal(
    (lms.sent[0].data.person as { email: string }).email,
    "late@lead.test",
  );
});

it("editing only notes raises no contact change", async () => {
  const admin = await newUser("super_admin");
  const s = await student("confirmed");
  const [{ version }] =
    await db()`SELECT version FROM person WHERE id = ${s.personId}`;
  await updatePerson(s.personId, { notes: "VIP" }, Number(version), admin);
  assert.ok(!(await outboxTypes()).includes("PersonContactChanged"));
});
