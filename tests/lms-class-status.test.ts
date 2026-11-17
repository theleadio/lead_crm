// What the LMS sync may do to a class's status (Shawn, 16 Nov 2026): the CRM
// owns it. The sync sets it on a new class and may mark a class completed once
// it has ended; draft, cancelled and the seat-driven statuses are never reset.
import assert from "node:assert/strict";
import { test } from "node:test";
import { syncClassStatus } from "../lib/import/lms-adopt.ts";

test("a new class is open, or completed if it has already ended", () => {
  assert.equal(syncClassStatus(null, false), "open");
  assert.equal(syncClassStatus(null, true), "completed");
});

test("a class still to run keeps whatever status the CRM gave it", () => {
  for (const s of [
    "draft",
    "open",
    "few_seats",
    "full",
    "cancelled",
    "completed",
  ])
    assert.equal(syncClassStatus(s, false), null, s);
});

test("an ended published class becomes completed", () => {
  for (const s of ["open", "few_seats", "full"])
    assert.equal(syncClassStatus(s, true), "completed", s);
});

test("an ended draft, cancelled or completed class is left alone", () => {
  for (const s of ["draft", "cancelled", "completed"])
    assert.equal(syncClassStatus(s, true), null, s);
});
