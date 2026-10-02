// Spec §7 (v1.7): the If-Match header a PATCH must carry. The courses PATCH
// (§9.7) turns a null here into 428 precondition_required, so the parse is
// what decides whether a save can skip the stale-edit check at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readIfMatch } from "../lib/api/errors.ts";

const withHeader = (value?: string) =>
  new Request("https://lead.test/api/courses/x", {
    method: "PATCH",
    headers: value === undefined ? {} : { "If-Match": value },
  });

test("If-Match: a positive whole number is the version", () => {
  assert.equal(readIfMatch(withHeader("1")), 1);
  assert.equal(readIfMatch(withHeader("42")), 42);
  assert.equal(readIfMatch(withHeader(" 7 ")), 7);
});

test("If-Match: missing, blank or not a version is null (428)", () => {
  for (const header of [
    undefined,
    "",
    "   ",
    "abc",
    "0",
    "-1",
    "1.5",
    "1e3",
    "NaN",
  ])
    assert.equal(readIfMatch(withHeader(header)), null, String(header));
});
