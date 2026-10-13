// Spec §9.10 Notices, §7.1, §11.1, §5 `class_notice`: reading a class's
// notices, correcting a pending one, approving it (which only queues it for
// Shawn's worker) and discarding it — and who may do each.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  approveNotice,
  discardNotice,
  editNotice,
  listClassNotices,
} from "../lib/classes/notices.ts";
import { updateClass } from "../lib/classes/service.ts";
import { ROLES, type Role, type Viewer } from "../lib/auth/permissions.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { classUpdateSchema } from "../lib/validation/class.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

async function newUser(role: Role = "operations"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, ${`Test ${role}`}, ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newClass(): Promise<{ id: string; version: number }> {
  const [course] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       venue_name, venue_address, city, capacity, status,
                       is_public)
    VALUES (${course.id}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 14,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 14,
            'en', 'in_person', 'LEAD Training Centre', '1 Jalan Test',
            'Kuala Lumpur', 20, 'open', true)
    RETURNING id, version`;
  return { id: c.id as string, version: Number(c.version) };
}

async function enrol(classId: string, status = "confirmed") {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Test person') RETURNING id`;
  await db()`
    INSERT INTO enrolment (person_id, class_id, status)
    VALUES (${p.id}, ${classId}, ${status})`;
}

// A pending notice as 9.9 makes one: a date change on a class with students,
// saved with the `prepare` choice.
async function pendingNotice(viewer: Viewer, startOffset = 21) {
  const cls = await newClass();
  await enrol(cls.id);
  const patch = classUpdateSchema.parse({
    startDate: new Date(Date.now() + startOffset * 86400000)
      .toISOString()
      .slice(0, 10),
    endDate: new Date(Date.now() + startOffset * 86400000)
      .toISOString()
      .slice(0, 10),
  });
  const result = await updateClass(
    cls.id,
    patch,
    cls.version,
    "prepare",
    viewer,
  );
  assert.equal(result.kind, "ok", JSON.stringify(result));
  const [notice] = await db()`
    SELECT id FROM class_notice WHERE class_id = ${cls.id} AND status = 'pending'`;
  assert.ok(notice, "9.9 should have prepared a pending notice");
  return {
    classId: cls.id,
    noticeId: notice.id as string,
    version: (result as { version: number }).version,
  };
}

const noticeRow = async (id: string) =>
  (await db()`SELECT * FROM class_notice WHERE id = ${id}`)[0];
const events = async (id: string, type: string) =>
  db()`SELECT * FROM event_outbox WHERE aggregate_id = ${id} AND type = ${type}`;

it("lists a class's notices pending first, then newest first", async () => {
  const viewer = await newUser();
  const { classId, noticeId } = await pendingNotice(viewer);
  // Two older notices that have already gone out.
  for (const days of [1, 2])
    await db()`
      INSERT INTO class_notice (class_id, status, changed_fields, message_en,
                                message_zh, recipient_count, created_by,
                                approved_by, approved_at, sent_at, created_at)
      VALUES (${classId}, 'sent', ${db().json({})}, 'old', '旧', 3,
              ${viewer.id}, ${viewer.id}, now(), now(),
              now() - ${`${days} days`}::interval)`;

  const rows = await listClassNotices(classId, viewer);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, noticeId);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[1].status, "sent");
  assert.ok(
    new Date(rows[1].createdAt) > new Date(rows[2].createdAt),
    "sent notices come back newest first",
  );
  assert.equal(rows[0].createdByName, "Test operations");
  assert.ok(rows[0].messageEn && rows[0].messageZh);
  assert.ok(rows[0].changedFields.startDate, "the notice says what changed");
});

it("a failed send is visible, and a class with no notices is an empty list", async () => {
  const viewer = await newUser();
  const cls = await newClass();
  assert.deepEqual(await listClassNotices(cls.id, viewer), []);

  await db()`
    INSERT INTO class_notice (class_id, status, changed_fields, message_en,
                              recipient_count, created_by, approved_by,
                              approved_at, sent_at, send_error)
    VALUES (${cls.id}, 'sent', ${db().json({})}, 'm', 2, ${viewer.id},
            ${viewer.id}, now(), now(), 'WATI rejected the template')`;
  const [row] = await listClassNotices(cls.id, viewer);
  assert.equal(row.sendError, "WATI rejected the template");
});

it("every role that reads classes reads the notices", async () => {
  const ops = await newUser();
  const { classId } = await pendingNotice(ops);
  for (const role of ROLES) {
    const viewer = await newUser(role);
    const rows = await listClassNotices(classId, viewer);
    assert.equal(rows.length, 1, `${role} should read the notices`);
  }
});

it("a pending message is stored as typed, leaving the notice's subject alone", async () => {
  const viewer = await newUser();
  const { noticeId } = await pendingNotice(viewer);
  const before = await noticeRow(noticeId);

  const result = await editNotice(
    noticeId,
    { messageEn: "Hello — the venue has moved to Level 3." },
    viewer,
  );
  assert.equal(result.kind, "ok");
  const after = await noticeRow(noticeId);
  assert.equal(after.message_en, "Hello — the venue has moved to Level 3.");
  // Untouched: the wording changed, not what the notice is about.
  assert.equal(after.message_zh, before.message_zh);
  assert.deepEqual(after.changed_fields, before.changed_fields);
  assert.equal(after.recipient_count, before.recipient_count);
  const [audit] = await db()`
    SELECT action, before, after FROM audit_log
    WHERE entity = 'class_notice' AND entity_id = ${noticeId}`;
  assert.equal(audit.action, "update");
});

it("approving records who and when, raises ClassNoticeApproved and sends nothing", async () => {
  const viewer = await newUser();
  const { noticeId, classId } = await pendingNotice(viewer);

  const result = await approveNotice(noticeId, viewer);
  assert.equal(result.kind, "ok");
  const row = await noticeRow(noticeId);
  assert.equal(row.status, "approved");
  assert.equal(row.approved_by, viewer.id);
  assert.ok(row.approved_at);
  // Sending is Shawn's worker's (§12.11): the app leaves these alone.
  assert.equal(row.sent_at, null);
  assert.equal(row.send_error, null);

  const raised = await events(noticeId, "ClassNoticeApproved");
  assert.equal(raised.length, 1);
  assert.deepEqual(raised[0].payload, { noticeId, classId });
});

it("approving twice raises one event only", async () => {
  const viewer = await newUser();
  const { noticeId } = await pendingNotice(viewer);
  assert.equal((await approveNotice(noticeId, viewer)).kind, "ok");

  const second = await approveNotice(noticeId, viewer);
  assert.equal(second.kind, "not_pending");
  assert.equal((second as { status: string }).status, "approved");
  assert.equal((await events(noticeId, "ClassNoticeApproved")).length, 1);
});

it("a notice that is not pending can't be edited, approved or discarded", async () => {
  const viewer = await newUser();
  for (const status of ["approved", "sent", "discarded"]) {
    const { noticeId } = await pendingNotice(viewer);
    // §5 CHECK: only approved and sent rows carry an approver, and only a
    // sent row carries `sent_at`.
    const approved = status === "approved" || status === "sent";
    await db()`
      UPDATE class_notice
      SET status = ${status},
          approved_by = ${approved ? viewer.id : null},
          approved_at = ${approved ? new Date() : null},
          sent_at = ${status === "sent" ? new Date() : null}
      WHERE id = ${noticeId}`;
    const before = await noticeRow(noticeId);

    for (const act of [
      () => editNotice(noticeId, { messageEn: "rewritten" }, viewer),
      () => approveNotice(noticeId, viewer),
      () => discardNotice(noticeId, viewer),
    ]) {
      const result = await act();
      assert.equal(result.kind, "not_pending", `${status} must be frozen`);
    }
    const after = await noticeRow(noticeId);
    assert.equal(after.status, before.status);
    assert.equal(after.message_en, before.message_en);
  }
});

it("an unknown notice is not found", async () => {
  const viewer = await newUser();
  assert.equal(
    (await approveNotice("00000000-0000-0000-0000-000000000000", viewer)).kind,
    "not_found",
  );
  assert.equal((await discardNotice("not-a-uuid", viewer)).kind, "not_found");
});

it("only super_admin and operations act on a notice", async () => {
  const ops = await newUser();
  const { noticeId } = await pendingNotice(ops);
  for (const role of ROLES) {
    if (role === "super_admin" || role === "operations") continue;
    const viewer = await newUser(role);
    for (const result of [
      await editNotice(noticeId, { messageEn: "no" }, viewer),
      await approveNotice(noticeId, viewer),
      await discardNotice(noticeId, viewer),
    ])
      assert.equal(result.kind, "forbidden", `${role} must not act`);
  }
  assert.equal((await noticeRow(noticeId)).status, "pending");
});

it("a discard stops the notice and frees the class for the next one", async () => {
  const viewer = await newUser();
  const { noticeId, classId, version } = await pendingNotice(viewer);

  assert.equal((await discardNotice(noticeId, viewer)).kind, "ok");
  assert.equal((await noticeRow(noticeId)).status, "discarded");
  assert.equal((await events(noticeId, "ClassNoticeApproved")).length, 0);

  // A second notice-worthy edit now creates a fresh pending notice carrying
  // only the new change (§5 one pending notice per class).
  const patch = classUpdateSchema.parse({ venueName: "Another venue" });
  const again = await updateClass(classId, patch, version, "prepare", viewer);
  assert.equal(again.kind, "ok", JSON.stringify(again));
  const [fresh] = await db()`
    SELECT id, changed_fields FROM class_notice
    WHERE class_id = ${classId} AND status = 'pending'`;
  assert.ok(fresh);
  assert.notEqual(fresh.id, noticeId);
  assert.deepEqual(Object.keys(fresh.changed_fields as object), ["venueName"]);
});
