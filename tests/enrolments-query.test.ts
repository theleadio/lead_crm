// Spec §7 list conventions for the enrolments list: what the screen may ask
// for, and what it may not. No database — the query shape is pure.
import test from "node:test";
import assert from "node:assert/strict";
import {
  enrolmentListQuerySchema,
  readEnrolmentParams,
} from "../lib/validation/enrolment-query.ts";

const CLASS_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const parse = (input: Record<string, string>) =>
  enrolmentListQuerySchema.safeParse(
    readEnrolmentParams(new URLSearchParams(input)),
  );

test("no query means upcoming classes, page 1 of 25", () => {
  const r = parse({});
  assert.ok(r.success);
  assert.equal(r.data.when, "upcoming");
  assert.equal(r.data.page, 1);
  assert.equal(r.data.limit, 25);
  assert.equal(r.data.sort, undefined);
  assert.equal(r.data.q, undefined);
});

test("the past view is asked for by name", () => {
  const r = parse({ when: "past" });
  assert.ok(r.success);
  assert.equal(r.data.when, "past");
  assert.equal(parse({ when: "someday" }).success, false);
});

test("the filters parse from filter[...]", () => {
  const r = parse({
    "filter[classId]": CLASS_ID,
    "filter[status]": "payment_pending",
    "filter[payerType]": "company",
    "filter[enrolledFrom]": "2026-10-01",
    "filter[enrolledTo]": "2026-10-31",
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.classId, CLASS_ID);
  assert.equal(r.data.status, "payment_pending");
  assert.equal(r.data.payerType, "company");
  assert.equal(r.data.enrolledFrom, "2026-10-01");
  assert.equal(r.data.enrolledTo, "2026-10-31");
});

// §12.4 statuses only: "paid" is not one of the eleven.
test("a status the schema does not have is rejected", () => {
  assert.equal(parse({ "filter[status]": "paid" }).success, false);
  assert.equal(parse({ "filter[payerType]": "someone_else" }).success, false);
  assert.equal(parse({ "filter[classId]": "not-an-id" }).success, false);
  assert.equal(parse({ "filter[enrolledFrom]": "31/10/2026" }).success, false);
});

test("hasPrice parses to a boolean, both ways", () => {
  const no = parse({ "filter[hasPrice]": "false" });
  assert.ok(no.success);
  assert.equal(no.data.hasPrice, false);
  const yes = parse({ "filter[hasPrice]": "true" });
  assert.ok(yes.success);
  assert.equal(yes.data.hasPrice, true);
  // Absent is not the same as false: no filter at all.
  const none = parse({});
  assert.ok(none.success);
  assert.equal(none.data.hasPrice, undefined);
  assert.equal(parse({ "filter[hasPrice]": "maybe" }).success, false);
});

// §7: default 25, max 100.
test("a limit above the maximum is rejected", () => {
  assert.equal(parse({ limit: "500" }).success, false);
  assert.equal(parse({ limit: "0" }).success, false);
  const ok = parse({ limit: "100", page: "3" });
  assert.ok(ok.success);
  assert.equal(ok.data.limit, 100);
  assert.equal(ok.data.page, 3);
});

test("sort is allow-listed in both directions", () => {
  for (const sort of [
    "enrolled",
    "-enrolled",
    "person",
    "-person",
    "class",
    "-class",
    "status",
    "-status",
  ])
    assert.equal(parse({ sort }).success, true, sort);
  assert.equal(parse({ sort: "price_paid_myr" }).success, false);
  assert.equal(parse({ sort: "person asc" }).success, false);
});

test("q is trimmed and capped", () => {
  const r = parse({ q: "  Tan Mei Ling  " });
  assert.ok(r.success);
  assert.equal(r.data.q, "Tan Mei Ling");
  assert.equal(parse({ q: "x".repeat(201) }).success, false);
});
