// Which CRM seats the LMS sync cancels because the LMS removed them (Jaman's
// point 9, Shawn's answer 3, 16 Nov 2026). Pure: no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  goneSeatCancels,
  MAX_GONE_CANCELS,
  type MarkedSeat,
} from "../lib/import/lms-adopt.ts";

const seat = (n: number, over: Partial<MarkedSeat> = {}): MarkedSeat => ({
  id: `crm${n}`,
  lms_enrollment_id: `lms${n}`,
  class_id: "k1",
  status: "confirmed",
  ...over,
});
const classes = new Set(["k1"]);

test("a confirmed seat the LMS no longer has is cancelled", () => {
  const r = goneSeatCancels([seat(1), seat(2)], new Set(["lms2"]), classes);
  assert.deepEqual(r, { cancel: ["crm1"], held: null, heldIds: [] });
});

test("a seat still in the LMS stays", () => {
  const r = goneSeatCancels([seat(1)], new Set(["lms1"]), classes);
  assert.deepEqual(r, { cancel: [], held: null, heldIds: [] });
});

test("a seat this run matched again or cut over is not cancelled or counted", () => {
  // Ops unenrolled and re-enrolled the student: lms1 is gone, but the seat was
  // matched to the new LMS seat this run (review of #88). crm2..crm7 were cut
  // over this run; they must not trip the cap either.
  const many = [seat(1), ...Array.from({ length: 6 }, (_, i) => seat(i + 2))];
  const settled = new Set(["crm1", "crm2", "crm3", "crm4", "crm5", "crm6", "crm7"]);
  const r = goneSeatCancels(many, new Set(["other"]), classes, settled);
  assert.deepEqual(r, { cancel: [], held: null, heldIds: [] });
});

test("attended, completed or already cancelled seats are never cancelled", () => {
  const seats = [
    "attended",
    "completed",
    "cancelled",
    "refunded",
    "transferred",
  ].map((status, i) => seat(i, { status }));
  assert.deepEqual(
    goneSeatCancels(seats, new Set(["other"]), classes).cancel,
    [],
  );
});

test("a seat whose whole class is gone from the LMS is left to staff", () => {
  const r = goneSeatCancels(
    [seat(1, { class_id: "gone" })],
    new Set(["other"]),
    classes,
  );
  assert.deepEqual(r.cancel, []);
});

test("an empty LMS read cancels nothing and says so", () => {
  const r = goneSeatCancels([seat(1)], new Set(), classes);
  assert.deepEqual(r.cancel, []);
  assert.match(r.held!, /no seats/);
});

test(`more than ${MAX_GONE_CANCELS} at once cancels nothing and says so`, () => {
  const many = Array.from({ length: MAX_GONE_CANCELS + 1 }, (_, i) => seat(i));
  const r = goneSeatCancels(many, new Set(["other"]), classes);
  assert.deepEqual(r.cancel, []);
  assert.match(r.held!, new RegExp(`${MAX_GONE_CANCELS + 1} seats`));
  // Every held seat is named, for the one Ops task; none is picked to cancel.
  assert.equal(r.heldIds.length, MAX_GONE_CANCELS + 1);
  const ok = goneSeatCancels(many.slice(1), new Set(["other"]), classes);
  assert.equal(ok.cancel.length, MAX_GONE_CANCELS);
});
