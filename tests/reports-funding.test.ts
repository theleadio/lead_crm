// §9.18 funding panels: the parts that need no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hrdcShare, priceTier } from "../lib/reports/funding.ts";

test("funding: HRDC share is a fraction of the seats taken", () => {
  assert.equal(hrdcShare(0, 4), 0);
  assert.equal(hrdcShare(1, 4), 0.25);
  assert.equal(hrdcShare(4, 4), 1);
});

// A query cannot return a row with no seats, but a share of 0/0 would be NaN
// and NaN plots at the top of the chart as if it were 100%.
test("funding: no seats is a share of zero, never NaN", () => {
  assert.equal(hrdcShare(0, 0), 0);
  assert.ok(!Number.isNaN(hrdcShare(0, 0)));
});

test("funding: the price tier is the course's duration", () => {
  assert.equal(priceTier(1), "1 day");
  assert.equal(priceTier(2), "2 days");
  assert.equal(priceTier(3), "3 days");
});
