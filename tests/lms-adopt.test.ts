import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adoptEnrolment,
  classIdForCohort,
  cohortsOnCancelledClass,
  cutOverCancels,
  importSeatsByKey,
  type Cohort,
  type ImportClass,
} from "../lib/import/lms-adopt.ts";

const cohort = (over: Partial<Cohort> = {}): Cohort => ({
  id: "k1",
  slug: "lms-slug",
  course_id: "c1",
  start_date: "2026-11-28",
  language: "zh",
  ...over,
});
const imp = (over: Partial<ImportClass> = {}): ImportClass => ({
  id: "i-en",
  code: "x-2026-11-28-en",
  course_id: "c1",
  start_date: "2026-11-28",
  language: "en",
  status: "open",
  ...over,
});
const pick = (k: Cohort, crm: string[], classes: ImportClass[], cohorts = [k]) => {
  const warnings: string[] = [];
  return { id: classIdForCohort(k, new Set(crm), classes, cohorts, warnings), warnings };
};

test("classIdForCohort: a cohort already in the CRM keeps its own id", () => {
  assert.equal(pick(cohort(), ["k1"], [imp()]).id, "k1");
});

test("classIdForCohort: one import class of the same course and start is adopted, any language", () => {
  assert.deepEqual(pick(cohort(), [], [imp()]), { id: "i-en", warnings: [] });
});

test("classIdForCohort: language picks between en and zh import classes", () => {
  const zh = imp({ id: "i-zh", code: "x-2026-11-28-zh", language: "zh" });
  assert.equal(pick(cohort(), [], [imp(), zh]).id, "i-zh");
});

test("classIdForCohort: no match, other course or other date gives the cohort id", () => {
  assert.equal(pick(cohort(), [], []).id, "k1");
  assert.equal(pick(cohort(), [], [imp({ course_id: "c2" })]).id, "k1");
  assert.equal(pick(cohort(), [], [imp({ start_date: "2026-11-29" })]).id, "k1");
});

test("classIdForCohort: an import class already adopted is found by code after the date moves", () => {
  const adopted = imp({ code: "lms-slug", start_date: "2026-11-21" });
  assert.equal(pick(cohort(), [], [adopted]).id, "i-en");
  const other = cohort({ id: "k2", slug: "s2", start_date: "2026-11-21" });
  assert.equal(pick(other, [], [adopted], [cohort(), other]).id, "k2");
});

test("classIdForCohort: ambiguous import classes are not adopted and are reported", () => {
  const twin = imp({ id: "i-en2", code: "x-other" });
  const r = pick(cohort({ language: "zh" }), [], [imp(), twin]);
  assert.equal(r.id, "k1");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /x-2026-11-28-en/);
  assert.match(r.warnings[0], /x-other/);
});

test("classIdForCohort: with an en and a zh cohort on one date, only the same language adopts", () => {
  const en = cohort({ id: "k-en", slug: "s-en", language: "en" });
  const zh = cohort({ id: "k-zh", slug: "s-zh", language: "zh" });
  assert.equal(pick(en, [], [imp()], [en, zh]).id, "i-en");
  assert.equal(pick(zh, [], [imp()], [en, zh]).id, "k-zh");
});

test("classIdForCohort: two cohorts of one course, date and language adopt nothing", () => {
  const a = cohort({ id: "k-a", slug: "s-a", language: "en" });
  const b = cohort({ id: "k-b", slug: "s-b", language: "en" });
  const r = pick(a, [], [imp()], [a, b]);
  assert.equal(r.id, "k-a");
  assert.equal(r.warnings.length, 1);
});

test("classIdForCohort: a cancelled import class still maps, by date and by code", () => {
  assert.equal(pick(cohort(), [], [imp({ status: "cancelled" })]).id, "i-en");
  const adopted = imp({ code: "lms-slug", start_date: "2026-11-21", status: "cancelled" });
  assert.equal(pick(cohort(), [], [adopted]).id, "i-en");
});

test("cohortsOnCancelledClass: only cohorts mapped to a cancelled import class", () => {
  const gone = imp({ id: "i-gone", code: "gone", status: "cancelled" });
  const live = imp({ id: "i-live", code: "live" });
  const classOf = new Map([
    ["k-gone", "i-gone"],
    ["k-live", "i-live"],
    ["k-own", "k-own"],
  ]);
  const r = cohortsOnCancelledClass(classOf, [gone, live]);
  assert.deepEqual([...r.keys()], ["k-gone"]);
  assert.equal(r.get("k-gone")?.code, "gone");
  assert.equal(cohortsOnCancelledClass(classOf, []).size, 0);
});

test("cutOverCancels", () => {
  const e = (id: string, class_id: string, status = "confirmed") => ({ id, class_id, status });
  const mapped = new Set(["started", "later"]);
  const started = new Set(["started", "unmapped"]);
  const run = (rows: ReturnType<typeof e>[], matched: string[] = []) =>
    cutOverCancels(rows, mapped, new Set(matched), started);
  assert.deepEqual(run([e("a", "started")]), ["a"]);
  assert.deepEqual(run([e("a", "started")], ["a"]), []);
  assert.deepEqual(run([e("a", "later")]), []);
  assert.deepEqual(run([e("a", "unmapped")]), []);
  assert.deepEqual(run([e("a", "started", "refunded")]), []);
  assert.deepEqual(run([e("a", "started", "cancelled")]), []);
  assert.deepEqual(run([e("a", "started", "onboarded")]), ["a"]);
  assert.deepEqual(run([e("a", "started", "completed")]), []);
  assert.deepEqual(run([e("a", "started", "attended")]), []);
});

const seat = (status: string, id = "s1") => ({ id, person_id: "p", class_id: "c", status });
const ended = new Date("2026-11-29");

test("importSeatsByKey: active wins over refunded, cancelled and transferred are ignored", () => {
  assert.equal(importSeatsByKey([seat("refunded", "r"), seat("confirmed", "a")]).get("p|c")?.id, "a");
  assert.equal(importSeatsByKey([seat("confirmed", "a"), seat("refunded", "r")]).get("p|c")?.id, "a");
  assert.equal(importSeatsByKey([seat("refunded", "r")]).get("p|c")?.id, "r");
  assert.equal(importSeatsByKey([seat("cancelled"), seat("transferred", "t")]).size, 0);
});

test("adoptEnrolment: a refunded seat skips the LMS row, every time", () => {
  assert.deepEqual(adoptEnrolment(seat("refunded"), null, new Set()), { action: "skip-refunded" });
  assert.deepEqual(adoptEnrolment(seat("refunded"), ended, new Set(["s1"])), { action: "skip-refunded" });
});

test("adoptEnrolment: confirmed moves to completed only once the class has ended", () => {
  assert.deepEqual(adoptEnrolment(seat("confirmed"), null, new Set()), { action: "same", id: "s1" });
  assert.deepEqual(adoptEnrolment(seat("confirmed"), ended, new Set()), {
    action: "update",
    id: "s1",
    status: "completed",
    completed_at: ended,
  });
});

test("adoptEnrolment: any status other than confirmed is left as is, never moved back", () => {
  for (const status of ["completed", "attended", "onboarded", "no_show"]) {
    assert.deepEqual(adoptEnrolment(seat(status), null, new Set()), { action: "same", id: "s1" });
    assert.deepEqual(adoptEnrolment(seat(status), ended, new Set()), { action: "same", id: "s1" });
  }
});

test("adoptEnrolment: a second LMS row for the same seat counts as same", () => {
  assert.deepEqual(adoptEnrolment(seat("confirmed"), ended, new Set(["s1"])), { action: "same", id: "s1" });
});
