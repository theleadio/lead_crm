// Spec §9.9 Class create/edit: who may write, the conditional field rules,
// and which edits a student has to be told about. No database — all three
// are pure.
import test from "node:test";
import assert from "node:assert/strict";
import { canWriteClass, ROLES, type Role } from "../lib/auth/permissions.ts";
import {
  draftMessages,
  hasNoticeWorthyChange,
  mergeChanges,
  noticeWorthyChanges,
} from "../lib/classes/notices.ts";
import { classWriteResponse } from "../lib/classes/write-response.ts";
import {
  checkClassRules,
  classCreateSchema,
  classUpdateSchema,
} from "../lib/validation/class.ts";
import { z } from "zod";

const COURSE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const validClass = {
  courseId: COURSE_ID,
  code: "AIA-2610-EN",
  startDate: "2026-10-06",
  endDate: "2026-10-07",
  language: "en",
  mode: "in_person",
  venueName: "LEAD Training Centre",
  venueAddress: "1 Jalan Test",
  city: "Kuala Lumpur",
  capacity: 25,
};

test("only super_admin and operations write a class (§6)", () => {
  const allowed: Role[] = ["super_admin", "operations"];
  for (const role of ROLES)
    assert.equal(
      canWriteClass({ id: "u", role }),
      allowed.includes(role),
      role,
    );
});

test("a complete in-person class is accepted", () => {
  const r = classCreateSchema.safeParse(validClass);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("the end date cannot be before the start date", () => {
  const r = classCreateSchema.safeParse({
    ...validClass,
    endDate: "2026-10-05",
  });
  assert.equal(r.success, false);
  assert.ok(r.error?.issues.some((i) => i.path[0] === "endDate"));
});

test("a class that meets somewhere needs a venue", () => {
  const r = classCreateSchema.safeParse({
    ...validClass,
    venueName: "",
    venueAddress: undefined,
    city: null,
  });
  assert.equal(r.success, false);
  const fields = r.error?.issues.map((i) => i.path[0]) ?? [];
  for (const f of ["venueName", "venueAddress", "city"])
    assert.ok(fields.includes(f), f);
});

test("a class that meets online needs a joining link", () => {
  const online = {
    ...validClass,
    mode: "online",
    venueName: null,
    venueAddress: null,
    city: null,
  };
  const missing = classCreateSchema.safeParse(online);
  assert.equal(missing.success, false);
  assert.ok(missing.error?.issues.some((i) => i.path[0] === "onlineUrl"));

  const ok = classCreateSchema.safeParse({
    ...online,
    onlineUrl: "https://meet.lead.test/aia",
  });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
});

test("a hybrid class needs both a venue and a link", () => {
  const r = classCreateSchema.safeParse({ ...validClass, mode: "hybrid" });
  assert.equal(r.success, false);
  assert.ok(r.error?.issues.some((i) => i.path[0] === "onlineUrl"));
});

test("capacity is a whole number above zero", () => {
  for (const capacity of [0, -1, 1.5])
    assert.equal(
      classCreateSchema.safeParse({ ...validClass, capacity }).success,
      false,
      String(capacity),
    );
});

test("a time outside HH:MM is refused", () => {
  for (const startTime of ["9am", "24:00", "09:60", "9:00"])
    assert.equal(
      classCreateSchema.safeParse({ ...validClass, startTime }).success,
      false,
      startTime,
    );
  assert.ok(
    classCreateSchema.safeParse({ ...validClass, startTime: "09:00" }).success,
  );
});

test("an empty patch saves nothing", () => {
  assert.equal(classUpdateSchema.safeParse({}).success, false);
  assert.ok(classUpdateSchema.safeParse({ capacity: 30 }).success);
});

// The service runs the conditionals on the stored row merged with the patch
// (design 8); this is that check on its own.
const merged = (row: Record<string, unknown>) => {
  const schema = z
    .object({})
    .passthrough()
    .superRefine((r, ctx) => checkClassRules(r, ctx));
  return schema.safeParse(row);
};

test("a patch that only changes the mode is judged on the merged row", () => {
  const stored = {
    startDate: "2026-10-06",
    endDate: "2026-10-07",
    venueName: "LEAD Training Centre",
    venueAddress: "1 Jalan Test",
    city: "Kuala Lumpur",
    onlineUrl: null,
  };
  // Going online needs no venue, so the stored venue is beside the point.
  assert.ok(
    merged({ ...stored, mode: "online", onlineUrl: "https://x.test" }).success,
  );
  // Coming back in person with nothing stored is refused per field.
  assert.equal(
    merged({
      ...stored,
      venueName: null,
      venueAddress: null,
      city: null,
      mode: "in_person",
    }).success,
    false,
  );
});

test("re-sending a field unchanged is not a change", () => {
  const before = {
    startDate: "2026-10-06",
    venueName: "LEAD Training Centre",
    capacity: 25,
  };
  assert.deepEqual(
    noticeWorthyChanges(before, { ...before, capacity: 30 }),
    {},
  );
  assert.equal(
    hasNoticeWorthyChange(noticeWorthyChanges(before, { ...before })),
    false,
  );
});

test("only the §9.9 fields that differ are notice-worthy", () => {
  const changes = noticeWorthyChanges(
    { startDate: "2026-10-06", venueName: "LEAD", city: "KL", priceMyr: "100" },
    {
      startDate: "2026-10-13",
      venueName: "LEAD",
      city: "Penang",
      priceMyr: "200",
    },
  );
  assert.deepEqual(changes, {
    startDate: { from: "2026-10-06", to: "2026-10-13" },
    city: { from: "KL", to: "Penang" },
  });
  assert.ok(hasNoticeWorthyChange(changes));
});

test("a second edit widens the pending notice, and an undo drops out", () => {
  const first = { startDate: { from: "2026-10-06", to: "2026-10-13" } };
  const widened = mergeChanges(first, {
    city: { from: "KL", to: "Penang" },
  });
  assert.deepEqual(widened, {
    startDate: { from: "2026-10-06", to: "2026-10-13" },
    city: { from: "KL", to: "Penang" },
  });

  // Moved back to where it started: the students were never told, so there
  // is nothing left to tell them.
  const undone = mergeChanges(first, {
    startDate: { from: "2026-10-13", to: "2026-10-06" },
  });
  assert.deepEqual(undone, {});
});

test("the drafted messages name the class and both values", () => {
  const { messageEn, messageZh } = draftMessages("AIA-2610-EN", {
    startDate: { from: "2026-10-06", to: "2026-10-13" },
    mode: { from: "in_person", to: "online" },
  });
  assert.ok(messageEn.includes("AIA-2610-EN"));
  assert.ok(
    messageEn.includes("06 Oct 2026") && messageEn.includes("13 Oct 2026"),
  );
  assert.ok(messageEn.includes("in person") && messageEn.includes("online"));
  assert.ok(messageZh.includes("AIA-2610-EN"));
  assert.ok(messageZh.includes("开课日期") && messageZh.includes("线上课"));
});

// The §7 status code each write result turns into. The routes all go through
// `classWriteResponse`, so this is the mapping they share (no route-handler
// harness exists in this project — see the 9.8 slice).
const viewer = {
  id: "11111111-1111-1111-1111-111111111111",
  role: "operations" as const,
};
const req = new Request("https://lead.test/api/classes/x", { method: "PATCH" });
const status = async (result: Parameters<typeof classWriteResponse>[0]) =>
  (await classWriteResponse(result, viewer, req, "edit classes")).status;

test("each write result maps to its §7 status code", async () => {
  assert.equal(await status({ kind: "ok", id: "x", version: 2 }), 200);
  assert.equal(await status({ kind: "not_found" }), 404);
  assert.equal(await status({ kind: "stale" }), 409);
  assert.equal(
    await status({ kind: "duplicate", code: "A", holder: "A" }),
    409,
  );
  assert.equal(await status({ kind: "capacity_below_seats", taken: 12 }), 422);
  assert.equal(
    await status({ kind: "notice_required", recipientCount: 3 }),
    409,
  );
  assert.equal(await status({ kind: "incomplete", missing: ["city"] }), 422);
  assert.equal(
    await status({
      kind: "cancelled",
      id: "x",
      version: 3,
      enrolmentCount: 12,
    }),
    200,
  );
  assert.equal(await status({ kind: "already_cancelled" }), 409);
  assert.equal(await status({ kind: "class_has_seats", taken: 4 }), 422);
  assert.equal(await status({ kind: "class_not_open" }), 422);
});

// §12.1 v1.9: the refusal says which way out there is, since Back to draft is
// not it once students have booked.
test("the back-to-draft 422 names the seats and the way out", async () => {
  const res = await classWriteResponse(
    { kind: "class_has_seats", taken: 4 },
    viewer,
    req,
    "open or redraft classes",
  );
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "class_has_seats");
  assert.match(body.error.message, /4 seats taken/);
  assert.match(body.error.message, /Cancel the class/);
});

// §9.10: the screen names the outcome, so the count comes back with the save.
test("a cancel returns the version and how many enrolments it took", async () => {
  const res = await classWriteResponse(
    { kind: "cancelled", id: "c1", version: 4, enrolmentCount: 12 },
    viewer,
    req,
    "cancel classes",
  );
  assert.deepEqual(await res.json(), {
    id: "c1",
    version: 4,
    enrolmentCount: 12,
  });
});

test("cancelling twice says so, and says nothing more was sent", async () => {
  const res = await classWriteResponse(
    { kind: "already_cancelled" },
    viewer,
    req,
    "cancel classes",
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "already_cancelled");
  assert.match(body.error.message, /already cancelled/i);
});

test("the notice 409 carries the count the dialog shows", async () => {
  const res = await classWriteResponse(
    { kind: "notice_required", recipientCount: 3 },
    viewer,
    req,
    "edit classes",
  );
  const body = await res.json();
  assert.equal(body.error.code, "notice_decision_required");
  assert.equal(body.error.recipientCount, 3);
  assert.ok(body.error.message.includes("3 students are enrolled"));
});

test("the capacity 422 names the seats already taken", async () => {
  const res = await classWriteResponse(
    { kind: "capacity_below_seats", taken: 12 },
    viewer,
    req,
    "edit classes",
  );
  const body = await res.json();
  assert.equal(body.error.code, "capacity_below_enrolments");
  assert.equal(body.error.fields.capacity, "At least 12");
  assert.ok(body.error.message.includes("12 seats taken"));
});

test("a created class answers 201", async () => {
  const res = await classWriteResponse(
    { kind: "ok", id: "x", version: 1 },
    viewer,
    req,
    "add classes",
    201,
  );
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: "x", version: 1 });
});
