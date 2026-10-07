// Spec §9.11 / §7.1 / §6: who the enrolment routes answer, and what each
// refusal says. No database — the §6 gate and the response mapper are pure.
// The routes themselves are these two decisions plus `getCurrentUser`, which
// is the session, not a rule.
import test from "node:test";
import assert from "node:assert/strict";
import { permissionFor, ROLES, type Role } from "../lib/auth/permissions.ts";
import type { EnrolmentWriteResult } from "../lib/enrolments/service.ts";
import { enrolmentWriteResponse } from "../lib/enrolments/write-response.ts";

const VIEWER = {
  id: "11111111-1111-1111-1111-111111111111",
  role: "operations" as const,
};
const REQUEST = new Request("http://test/api/enrolments/x/status", {
  method: "POST",
});

async function mapped(result: EnrolmentWriteResult) {
  const res = await enrolmentWriteResponse(result, VIEWER, REQUEST, "testing");
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// §6 enrolment row: F R - R R F -. Marketing and part_time have no access at
// all, so GET /api/enrolments/:id is an audited 403 for them (§6, §13).
test("five roles read an enrolment, two have no access (§6)", () => {
  const readers: Role[] = [
    "super_admin",
    "management",
    "sales",
    "support",
    "operations",
  ];
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "enrolment", "read").allowed,
      readers.includes(role),
      role,
    );
});

test("only super_admin and operations write an enrolment (§6)", () => {
  const writers: Role[] = ["super_admin", "operations"];
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "enrolment", "write").allowed,
      writers.includes(role),
      role,
    );
});

// §7: every refusal its own code, every message saying what to do next (§13).
// `forbidden` is left out here — it writes the §6 audit row, so it is checked
// against the database in tests/enrolments-status-db.test.ts.
test("a saved enrolment answers with its new version", async () => {
  assert.deepEqual(await mapped({ kind: "ok", id: "e1", version: 4 }), {
    status: 200,
    body: { id: "e1", version: 4 },
  });
  assert.equal(
    (await mapped({ kind: "created", id: "e1", version: 1 })).status,
    201,
  );
});

test("a §12.4 refusal is 422 and names the legal moves", async () => {
  const { status, body } = await mapped({
    kind: "illegal_transition",
    from: "reserved",
    to: "completed",
    allowed: ["payment_pending", "confirmed", "waitlisted", "cancelled"],
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, "illegal_transition");
  assert.match(body.error.message, /Payment pending|payment pending/);
  assert.match(body.error.message, /can't become completed/);
});

test("an end status says it cannot change at all", async () => {
  const { body } = await mapped({
    kind: "illegal_transition",
    from: "completed",
    to: "confirmed",
    allowed: [],
  });
  assert.match(body.error.message, /can't change status/);
});

test("a full class is 409 no_seats and says the way out", async () => {
  const { status, body } = await mapped({
    kind: "no_seats",
    classCode: "AIA-2601",
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "no_seats");
  assert.match(body.error.message, /AIA-2601 has no seats left/);
  assert.match(body.error.message, /another class/);
});

test("a double booking is 409 and points at the enrolment that exists", async () => {
  const { status, body } = await mapped({
    kind: "duplicate",
    classCode: "AIA-2601",
    enrolmentId: "e9",
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "already_enrolled");
  assert.equal(body.error.existing.id, "e9");
});

test("a stale version is 409 stale_edit, a missing row 404", async () => {
  assert.equal((await mapped({ kind: "stale" })).status, 409);
  assert.equal((await mapped({ kind: "stale" })).body.error.code, "stale_edit");
  assert.equal((await mapped({ kind: "not_found" })).status, 404);
});

test("transfer refusals are 422 and say why", async () => {
  const notConfirmed = await mapped({
    kind: "not_transferable",
    status: "reserved",
  });
  assert.equal(notConfirmed.status, 422);
  assert.match(notConfirmed.body.error.message, /confirmed/);
  const same = await mapped({ kind: "same_class" });
  assert.equal(same.status, 422);
  assert.equal(same.body.error.code, "same_class");
});

test("a transfer answers with the new enrolment and class", async () => {
  const { status, body } = await mapped({
    kind: "transferred",
    id: "e1",
    version: 2,
    newEnrolmentId: "e2",
    toClassCode: "AIA-2602",
  });
  assert.equal(status, 200);
  assert.equal(body.newEnrolmentId, "e2");
  assert.equal(body.toClassCode, "AIA-2602");
});
