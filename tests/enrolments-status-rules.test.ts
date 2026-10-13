// Spec §12.4 Enrolment state machine. No database — the table is pure, and
// every status the schema allows is checked against the diagram.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ENROLMENT_STATUSES,
  canChangeTo,
  canTransfer,
  nextStatuses,
  statusMoves,
  type EnrolmentStatus,
} from "../lib/enrolments/status-rules.ts";

// The §12.4 diagram, written out again by hand so the test disagrees with the
// table if either is edited alone.
const DIAGRAM: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  reserved: ["payment_pending", "confirmed", "waitlisted", "cancelled"],
  payment_pending: ["confirmed", "cancelled"],
  waitlisted: ["reserved"],
  confirmed: ["onboarded", "transferred", "cancelled"],
  onboarded: ["attended", "cancelled", "no_show"],
  attended: ["completed"],
  completed: [],
  no_show: [],
  transferred: [],
  cancelled: ["refunded"],
  refunded: [],
};

test("every status offers exactly the §12.4 arrows", () => {
  for (const status of ENROLMENT_STATUSES) {
    assert.deepEqual(
      [...nextStatuses(status)].sort(),
      [...DIAGRAM[status]].sort(),
      `next statuses for ${status}`,
    );
  }
});

test("all eleven statuses are covered, no twelfth invented", () => {
  assert.equal(ENROLMENT_STATUSES.length, 11);
  assert.deepEqual(
    [...ENROLMENT_STATUSES].sort(),
    Object.keys(DIAGRAM).sort() as EnrolmentStatus[],
  );
});

test("a status never moves to itself", () => {
  for (const status of ENROLMENT_STATUSES)
    assert.equal(canChangeTo(status, status), false, `${status} to itself`);
});

test("the four end statuses offer nothing", () => {
  for (const status of [
    "completed",
    "no_show",
    "transferred",
    "refunded",
  ] as const)
    assert.deepEqual(nextStatuses(status), []);
});

// §12.4 v1.10: cancelling reaches a student who has been onboarded, but never
// one the class has already taught.
test("onboarded cancels, attended and completed do not", () => {
  assert.equal(canChangeTo("onboarded", "cancelled"), true);
  for (const status of ["attended", "completed", "no_show"] as const)
    assert.equal(canChangeTo(status, "cancelled"), false, status);
});

test("a cancelled enrolment can only be refunded", () => {
  assert.deepEqual(nextStatuses("cancelled"), ["refunded"]);
  assert.equal(canChangeTo("cancelled", "confirmed"), false);
});

test("an unknown status offers nothing rather than throwing", () => {
  assert.deepEqual(nextStatuses("nonsense"), []);
  assert.equal(canChangeTo("nonsense", "confirmed"), false);
});

test("only a confirmed enrolment transfers (§12.4)", () => {
  for (const status of ENROLMENT_STATUSES)
    assert.equal(canTransfer(status), status === "confirmed", status);
});

// §5: a transferred row must name the enrolment it became, so only the transfer
// action writes that status — the status control never offers it.
test("the status control never offers transferred", () => {
  assert.ok(nextStatuses("confirmed").includes("transferred"));
  assert.deepEqual(statusMoves("confirmed"), ["onboarded", "cancelled"]);
  assert.equal(canChangeTo("confirmed", "transferred"), false);
});

test("every other move survives statusMoves", () => {
  for (const status of ENROLMENT_STATUSES)
    assert.deepEqual(
      statusMoves(status),
      nextStatuses(status).filter((s) => s !== "transferred"),
      status,
    );
});
