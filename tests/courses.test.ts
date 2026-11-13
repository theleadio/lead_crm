// Spec §7 (v1.7): the If-Match header a PATCH must carry. The courses PATCH
// (§9.7) turns a null here into 428 precondition_required, so the parse is
// what decides whether a save can skip the stale-edit check at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readIfMatch } from "../lib/api/errors.ts";
import { versionHeaders } from "../lib/api/version-headers.ts";

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

// The live site (Netlify) drops If-Match before it reaches the app (13 Nov:
// every save on the live site said "Reload … and try again", localhost was
// fine). Screens also send the version as X-Row-Version, which it passes.
const withHeaders = (headers: Record<string, string>) =>
  new Request("https://lead.test/api/courses/x", { method: "PATCH", headers });

test("X-Row-Version is the version when If-Match is missing", () => {
  assert.equal(readIfMatch(withHeaders({ "X-Row-Version": "3" })), 3);
});

test("If-Match wins when both are usable; an unusable one falls back", () => {
  assert.equal(
    readIfMatch(withHeaders({ "If-Match": "4", "X-Row-Version": "9" })),
    4,
  );
  assert.equal(
    readIfMatch(withHeaders({ "If-Match": '"4"', "X-Row-Version": "4" })),
    4,
  );
  assert.equal(readIfMatch(withHeaders({ "X-Row-Version": "0" })), null);
});

test("screens send the version in both headers", () => {
  assert.deepEqual(versionHeaders(5), {
    "If-Match": "5",
    "X-Row-Version": "5",
  });
});
