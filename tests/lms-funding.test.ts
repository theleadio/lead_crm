// How an LMS enrollment's funding_type becomes the seat's funding (migration
// 023, 12 Nov). Pure: no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lmsFundingType, seatSyncKey } from "../lib/import/lms-funding.ts";

test("every LMS funding value the CRM knows is kept as it is", () => {
  for (const v of [
    "self_funded",
    "hrdc",
    "internal",
    "leaders_club",
    "refresher",
  ])
    assert.deepEqual(lmsFundingType(v), { funding: v, unknown: null });
});

test("an unknown or missing value becomes empty, and an unknown one is named", () => {
  assert.deepEqual(lmsFundingType("scholarship"), {
    funding: null,
    unknown: "scholarship",
  });
  assert.deepEqual(lmsFundingType(null), { funding: null, unknown: null });
  assert.deepEqual(lmsFundingType(""), { funding: null, unknown: null });
});

test("a funding change on an existing seat counts as a change", () => {
  // The sync skips a seat whose key is unchanged; before 023 the key was the
  // amount alone, so a funding change was never written.
  assert.notEqual(seatSyncKey(1500, "hrdc"), seatSyncKey(1500, "self_funded"));
  assert.notEqual(seatSyncKey(1500, "hrdc"), seatSyncKey(1500, null));
  assert.equal(seatSyncKey(1500, "hrdc"), seatSyncKey(1500, "hrdc"));
});
