// Free LMS courses the sync leaves out (Shawn, 20 Nov 2026). Pure: no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutSkippedCourses } from "../lib/import/lms-adopt.ts";

const src = {
  courses: [
    { id: "c1", name: "AI Certification" },
    { id: "c2", name: " vibe coding MASTERCLASS " },
  ],
  cohorts: [
    { id: "k1", course_id: "c1" },
    { id: "k2", course_id: "c2" },
  ],
  people: [{ id: "p1" }, { id: "p2" }],
  enrols: [
    { id: "e1", cohort_id: "k1" },
    { id: "e2", cohort_id: "k2" },
  ],
};

test("a skipped course drops its classes and seats, never its people", () => {
  const r = withoutSkippedCourses(src);
  assert.deepEqual(
    r.courses.map((c) => c.id),
    ["c1"],
  );
  assert.deepEqual(
    r.cohorts.map((k) => k.id),
    ["k1"],
  );
  assert.deepEqual(
    r.enrols.map((e) => e.id),
    ["e1"],
  );
  assert.deepEqual(r.people, src.people);
});

test("an empty skip list keeps everything", () => {
  assert.deepEqual(withoutSkippedCourses(src, []), src);
});
