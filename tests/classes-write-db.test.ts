// Spec §9.9 create/edit and §7.1: a new class is a draft, capacity never
// drops under the seats taken (§12.1), and an edit that moves a class with
// students has to answer the notice question before anything is written.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  createClass,
  setClassStatus,
  setClassVisibility,
  updateClass,
} from "../lib/classes/service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import type { Viewer } from "../lib/auth/permissions.ts";
import { classCreateSchema } from "../lib/validation/class.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

async function newUser(role = "operations"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role: role as Viewer["role"] };
}

async function newCourse(hrdc = true): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, hrdc_claimable)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1, ${hrdc})
    RETURNING id`;
  return c.id;
}

const input = (courseId: string, over: Record<string, unknown> = {}) =>
  classCreateSchema.parse({
    courseId,
    code: `C-${crypto.randomUUID()}`,
    startDate: "2026-11-02",
    endDate: "2026-11-03",
    language: "en",
    mode: "in_person",
    venueName: "LEAD Training Centre",
    venueAddress: "1 Jalan Test",
    city: "Kuala Lumpur",
    capacity: 10,
    ...over,
  });

async function created(viewer: Viewer, over: Record<string, unknown> = {}) {
  const r = await createClass(input(await newCourse(), over), viewer);
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return r as { kind: "ok"; id: string; version: number };
}

async function enrol(classId: string, status: string) {
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Test person') RETURNING id`;
  await db()`
    INSERT INTO enrolment (person_id, class_id, status, completed_at)
    VALUES (${p.id}, ${classId}, ${status},
            ${status === "completed" ? new Date() : null})`;
}

const row = async (id: string) =>
  (await db()`SELECT * FROM class WHERE id = ${id}`)[0];
const notices = async (id: string) =>
  db()`SELECT * FROM class_notice WHERE class_id = ${id} ORDER BY created_at`;
const events = async (id: string, type: string) =>
  db()`SELECT * FROM event_outbox WHERE aggregate_id = ${id} AND type = ${type}`;

it("a new class is a draft and not public, whatever was sent", async () => {
  const viewer = await newUser();
  const { id } = await created(viewer);
  const c = await row(id);
  assert.equal(c.status, "draft");
  assert.equal(c.is_public, false);
  // §5: hrdc_claimable defaults from the course.
  assert.equal(c.hrdc_claimable, true);
  const [audit] = await db()`
    SELECT action FROM audit_log WHERE entity = 'class' AND entity_id = ${id}`;
  assert.equal(audit.action, "create");
});

it("a taken code is refused and names the holder", async () => {
  const viewer = await newUser();
  const courseId = await newCourse();
  const first = input(courseId, { code: "DUP-1" });
  assert.equal((await createClass(first, viewer)).kind, "ok");
  const second = await createClass(input(courseId, { code: "DUP-1" }), viewer);
  assert.deepEqual(second, {
    kind: "duplicate",
    code: "DUP-1",
    holder: "DUP-1",
  });
});

it("only super_admin and operations write", async () => {
  const sales = await newUser("sales");
  assert.equal(
    (await createClass(input(await newCourse()), sales)).kind,
    "forbidden",
  );
});

it("capacity may not drop under the seats taken, but may meet them", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer, { capacity: 12 });
  for (let i = 0; i < 10; i++) await enrol(id, "confirmed");

  const under = await updateClass(
    id,
    { capacity: 9 },
    version,
    undefined,
    viewer,
  );
  assert.deepEqual(under, { kind: "capacity_below_seats", taken: 10 });
  assert.equal((await row(id)).capacity, 12);

  const exact = await updateClass(
    id,
    { capacity: 10 },
    version,
    undefined,
    viewer,
  );
  assert.equal(exact.kind, "ok");
  assert.equal((await row(id)).capacity, 10);
});

it("an expired reservation does not hold the capacity up", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer, { capacity: 10 });
  const [p] = await db()`
    INSERT INTO person (full_name) VALUES ('Reserved') RETURNING id`;
  await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until)
    VALUES (${p.id}, ${id}, 'reserved', now() - interval '1 hour')`;

  assert.equal(
    (await updateClass(id, { capacity: 1 }, version, undefined, viewer)).kind,
    "ok",
  );
});

it("a price-only edit on a full class saves with no notice", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  for (let i = 0; i < 3; i++) await enrol(id, "confirmed");

  const r = await updateClass(
    id,
    { priceMyr: "3200" },
    version,
    undefined,
    viewer,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await notices(id)).length, 0);
});

it("moving the date of a class with students asks first and writes nothing", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  for (const status of ["confirmed", "onboarded", "attended"])
    await enrol(id, status);
  // Not recipients: neither has committed (§9.9).
  await enrol(id, "reserved");
  await enrol(id, "payment_pending");

  const asked = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    undefined,
    viewer,
  );
  assert.deepEqual(asked, { kind: "notice_required", recipientCount: 3 });
  const unchanged = await row(id);
  assert.equal(unchanged.start_date.toISOString().slice(0, 10), "2026-11-02");
  assert.equal(Number(unchanged.version), version);
  assert.equal((await notices(id)).length, 0);
});

it("the same edit on a class with no recipients saves straight away", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  await enrol(id, "cancelled");

  const r = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    undefined,
    viewer,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await notices(id)).length, 0);
});

it("prepare writes one pending notice and a ClassChanged event", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  await enrol(id, "confirmed");

  const saved = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    "prepare",
    viewer,
  );
  assert.equal(saved.kind, "ok");

  const [notice] = await notices(id);
  assert.equal(notice.status, "pending");
  assert.equal(notice.recipient_count, 1);
  assert.deepEqual(notice.changed_fields.startDate, {
    from: "2026-11-02",
    to: "2026-11-09",
  });
  assert.ok(notice.message_en.includes("09 Nov 2026"));
  assert.ok(notice.message_zh.includes("开课日期"));

  const [event] = await events(id, "ClassChanged");
  assert.equal(event.payload.noticeId, notice.id);
  assert.equal(event.processed_at, null);
});

it("a second edit widens the same pending notice", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  await enrol(id, "confirmed");

  const first = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    "prepare",
    viewer,
  );
  assert.equal(first.kind, "ok");
  const v2 = (first as { version: number }).version;

  const second = await updateClass(
    id,
    { city: "Penang" },
    v2,
    "prepare",
    viewer,
  );
  assert.equal(second.kind, "ok");

  const all = await notices(id);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].changed_fields.city, {
    from: "Kuala Lumpur",
    to: "Penang",
  });
  assert.deepEqual(all[0].changed_fields.startDate, {
    from: "2026-11-02",
    to: "2026-11-09",
  });
});

it("skip saves the edit, writes no notice, still raises ClassChanged", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  await enrol(id, "confirmed");

  const r = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    "skip",
    viewer,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await notices(id)).length, 0);
  // §11.1: the change happened to students who are coming, whether or not
  // anyone was told. No notice, so no noticeId.
  const raised = await events(id, "ClassChanged");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].payload.noticeId, null);
  assert.deepEqual(raised[0].payload.changedFields.startDate, {
    from: "2026-11-02",
    to: "2026-11-09",
  });
});

it("an edit on a class nobody is coming to raises nothing", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  // A reservation is not a commitment, so §11.1's "w/ enrolments" is not met.
  await enrol(id, "reserved");

  const r = await updateClass(
    id,
    { startDate: "2026-11-09", endDate: "2026-11-10" },
    version,
    undefined,
    viewer,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await events(id, "ClassChanged")).length, 0);
});

it("an edit that breaks the §9.9 rules is refused per field", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);

  const backwards = await updateClass(
    id,
    { endDate: "2026-11-01" },
    version,
    undefined,
    viewer,
  );
  assert.deepEqual(backwards, { kind: "incomplete", missing: ["endDate"] });

  const online = await updateClass(
    id,
    { mode: "online" },
    version,
    undefined,
    viewer,
  );
  assert.deepEqual(online, { kind: "incomplete", missing: ["onlineUrl"] });
  assert.equal((await row(id)).mode, "in_person");
});

it("a stale version writes nothing", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  assert.equal(
    (await updateClass(id, { capacity: 20 }, version + 1, undefined, viewer))
      .kind,
    "stale",
  );
  assert.equal((await row(id)).capacity, 10);
  assert.equal(
    (
      await updateClass(
        crypto.randomUUID(),
        { capacity: 20 },
        1,
        undefined,
        viewer,
      )
    ).kind,
    "not_found",
  );
});

it("Open for booking opens a draft, and the database writes ClassPublished", async () => {
  const viewer = await newUser();
  const good = await created(viewer);
  const opened = await setClassStatus(good.id, "open", good.version, viewer);
  assert.equal(opened.kind, "ok");
  const live = await row(good.id);
  assert.equal(live.status, "open");
  // §12.1 v1.9: opening for booking never touches the website flag.
  assert.equal(live.is_public, false);
  // One event, written by the 006 trigger and not by the service (§12.11).
  // Two rows here would mean the app started raising it again.
  const [event, ...extra] = await events(good.id, "ClassPublished");
  assert.equal(extra.length, 0);
  assert.equal(event.payload.toStatus, "open");
  assert.equal(event.payload.toPublic, false);
});

it("the website toggle writes is_public and nothing else", async () => {
  const viewer = await newUser();
  const good = await created(viewer);
  // Refused while the class is still a draft (§12.1 v1.9).
  assert.deepEqual(
    await setClassVisibility(good.id, true, good.version, viewer),
    { kind: "class_not_open" },
  );
  assert.equal((await row(good.id)).is_public, false);

  const opened = await setClassStatus(good.id, "open", good.version, viewer);
  const shown = await setClassVisibility(
    good.id,
    true,
    (opened as { version: number }).version,
    viewer,
  );
  assert.equal(shown.kind, "ok");
  const live = await row(good.id);
  assert.equal(live.is_public, true);
  assert.equal(live.status, "open");

  const hidden = await setClassVisibility(
    good.id,
    false,
    (shown as { version: number }).version,
    viewer,
  );
  assert.equal(hidden.kind, "ok");
  const after = await row(good.id);
  assert.equal(after.is_public, false);
  // Hiding stops the website listing it; the class still takes bookings.
  assert.equal(after.status, "open");
});

it("Back to draft is refused while anyone holds a seat", async () => {
  const viewer = await newUser();
  const good = await created(viewer);
  const opened = await setClassStatus(good.id, "open", good.version, viewer);
  const openVersion = (opened as { version: number }).version;
  await setClassVisibility(good.id, true, openVersion, viewer);
  await enrol(good.id, "confirmed");
  const held = await row(good.id);

  assert.deepEqual(
    await setClassStatus(good.id, "draft", Number(held.version), viewer),
    { kind: "class_has_seats", taken: 1 },
  );
  const unchanged = await row(good.id);
  assert.equal(unchanged.status, "open");
  assert.equal(unchanged.is_public, true);
});

it("Back to draft on an empty class also takes it off the website", async () => {
  const viewer = await newUser();
  const good = await created(viewer);
  const opened = await setClassStatus(good.id, "open", good.version, viewer);
  const shown = await setClassVisibility(
    good.id,
    true,
    (opened as { version: number }).version,
    viewer,
  );

  const back = await setClassStatus(
    good.id,
    "draft",
    (shown as { version: number }).version,
    viewer,
  );
  assert.equal(back.kind, "ok");
  const drafted = await row(good.id);
  assert.equal(drafted.status, "draft");
  assert.equal(drafted.is_public, false);
});

it("a cancelled class is not opened or redrafted here", async () => {
  const viewer = await newUser();
  const { id } = await created(viewer);
  await db()`UPDATE class SET status = 'cancelled' WHERE id = ${id}`;
  const c = await row(id);
  const r = await setClassStatus(id, "open", Number(c.version), viewer);
  assert.deepEqual(r, { kind: "incomplete", missing: ["status"] });
  assert.equal((await row(id)).status, "cancelled");
});

it("a refused save leaves no audit row", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer);
  await updateClass(id, { capacity: 20 }, version + 1, undefined, viewer);
  const rows = await db()`
    SELECT action FROM audit_log WHERE entity = 'class' AND entity_id = ${id}`;
  assert.deepEqual(
    rows.map((r) => r.action),
    ["create"],
  );
});

it("re-sending the stored times is not a change", async () => {
  const viewer = await newUser();
  const { id, version } = await created(viewer, {
    startTime: "09:00",
    endTime: "17:00",
  });
  await enrol(id, "confirmed");

  // The form sends every field on every save; a `time` column reads back as
  // "09:00:00", so an unnormalised compare asked for a notice nobody needed.
  const r = await updateClass(
    id,
    { capacity: 20, startTime: "09:00", endTime: "17:00" },
    version,
    undefined,
    viewer,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await notices(id)).length, 0);
});
