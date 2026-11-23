import { test } from "node:test";
import assert from "node:assert/strict";
import { lmsLockedChanges, lmsLockedFields } from "../lib/classes/lms-lock.ts";

const ID = "00000000-0000-0000-0000-00000000c1a5";
const OTHER = "00000000-0000-0000-0000-0000000c0407";
const before = {
  code: "AIA-2612-EN",
  startDate: new Date("2026-12-14T00:00:00Z"),
  endDate: new Date("2026-12-15T00:00:00Z"),
  language: "en",
};

test("a class the LMS doesn't know locks nothing", () => {
  assert.deepEqual(lmsLockedFields({ id: ID, lms_cohort_id: null }), []);
});

test("a class the LMS made locks code, dates and language", () => {
  assert.deepEqual(lmsLockedFields({ id: ID, lms_cohort_id: ID }), [
    "code",
    "startDate",
    "endDate",
    "language",
  ]);
});

test("a CRM class the sync adopted keeps its code editable", () => {
  assert.deepEqual(lmsLockedFields({ id: ID, lms_cohort_id: OTHER }), [
    "startDate",
    "endDate",
    "language",
  ]);
});

test("sending locked fields back unchanged is not a change", () => {
  const locked = lmsLockedFields({ id: ID, lms_cohort_id: ID });
  const patch = {
    code: " AIA-2612-EN ",
    startDate: "2026-12-14",
    endDate: "2026-12-15",
    language: "en",
  };
  assert.deepEqual(lmsLockedChanges(locked, patch, before), []);
});

test("changing a locked field is refused, an unlocked one is not", () => {
  const adopted = lmsLockedFields({ id: ID, lms_cohort_id: OTHER });
  assert.deepEqual(
    lmsLockedChanges(
      adopted,
      { code: "NEW-CODE", startDate: "2026-12-21", language: "zh" },
      before,
    ),
    ["startDate", "language"],
  );
});

test("a patch without locked fields changes nothing locked", () => {
  const locked = lmsLockedFields({ id: ID, lms_cohort_id: ID });
  assert.deepEqual(lmsLockedChanges(locked, {}, before), []);
});
