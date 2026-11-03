import assert from "node:assert/strict";
import { test } from "node:test";
import { classIdForCohort, cutOverCancels, type Cohort, type ImportClass } from "../lib/import/lms-adopt.ts";

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
  assert.deepEqual(run([e("a", "started", "completed")]), ["a"]);
});
