import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCT_COURSE, ONLINE_COURSES, classCodeFor, classIdFor, enrolmentIdFor, orderState, pickClass, uuidV5 } from "../lib/import/salesprocess-enrolments.ts";

const txn = (status: string, day: number, amount_myr: number, refunded_myr = 0) => ({ status, paid_at: new Date(Date.UTC(2026, 9, day)), amount_myr, refunded_myr });

test("uuidV5 is a stable v5 uuid", () => {
  const id = uuidV5("sp-enrolment|abc");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, uuidV5("sp-enrolment|abc"));
  assert.notEqual(enrolmentIdFor("a"), enrolmentIdFor("b"));
  assert.notEqual(classIdFor("lms-x", "2026-11-28", "en"), classIdFor("lms-x", "2026-11-28", "zh"));
});

test("orderState: latest paid_at decides", () => {
  assert.deepEqual(orderState([txn("succeeded", 1, 3200)]), { state: "paid", priceMyr: 3200 });
  assert.equal(orderState([txn("succeeded", 1, 3200), txn("refunded", 2, 3200, 3200)]).state, "refunded");
  assert.deepEqual(orderState([txn("partially_refunded", 1, 3200, 200)]), { state: "paid", priceMyr: 3000 });
  assert.deepEqual(orderState([txn("failed", 1, 3200)]), { state: "ignore", priceMyr: 0 });
  assert.deepEqual(orderState([]), { state: "ignore", priceMyr: 0 });
});

test("orderState: input order does not matter, ties keep the last", () => {
  assert.equal(orderState([txn("refunded", 2, 10, 10), txn("succeeded", 1, 10)]).state, "refunded");
  assert.equal(orderState([txn("failed", 1, 10), txn("succeeded", 1, 10)]).state, "paid");
});

test("pickClass", () => {
  const en = { id: "e", language: "en" as const };
  const zh = { id: "z", language: "zh" as const };
  assert.equal(pickClass([], "en"), null);
  assert.equal(pickClass([en], "zh"), "e");
  assert.equal(pickClass([en, zh], "zh"), "z");
  assert.equal(pickClass([en, zh], null), "ambiguous");
  assert.equal(pickClass([en, { id: "e2", language: "en" }], "en"), "ambiguous");
});

test("classCodeFor", () => {
  assert.equal(classCodeFor("lms-claude-ai-mastery", "2026-11-28", "zh"), "claude-ai-mastery-2026-11-28-zh");
});

test("product map", () => {
  assert.equal(PRODUCT_COURSE["AI Vibe Coding 实战课 "], "lms-ai-vibe-coding");
  assert.equal(PRODUCT_COURSE["Unknown"], undefined);
  assert.equal(Object.keys(PRODUCT_COURSE).length, 12);
  assert.ok(ONLINE_COURSES.has("lms-ai-agents-online-workshop"));
});
