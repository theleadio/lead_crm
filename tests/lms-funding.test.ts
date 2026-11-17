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
    "guest",
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
  assert.notEqual(seatSyncKey("hrdc"), seatSyncKey("self_funded"));
  assert.notEqual(seatSyncKey("hrdc"), seatSyncKey(null));
  assert.equal(seatSyncKey("hrdc"), seatSyncKey("hrdc"));
});

test("the seat key matches the CRM row read back without its id", () => {
  // existing() in sync-lms.ts keys a row on JSON.stringify(values after id) of
  // `SELECT id, funding_type FROM enrolment`; price is no longer part of it.
  const row = { id: "e1", funding_type: "hrdc" };
  assert.equal(JSON.stringify(Object.values(row).slice(1)), seatSyncKey("hrdc"));
});
