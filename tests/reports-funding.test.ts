// §9.18 funding panels: the parts that need no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hrdcShare,
  priceShareFromFunding,
  priceTier,
} from "../lib/reports/funding.ts";

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

// The scatter built from the LMS rows: one point per course, not per language,
// and nothing plotted for a course the CRM has no price for.
test("funding: the scatter sums a course's languages into one point", () => {
  const rows = priceShareFromFunding([
    {
      course: "AI Vibe Coding",
      language: "en",
      durationDays: 1,
      listPriceMyr: "680.00",
      hrdc: 2,
      notHrdc: 8,
    },
    {
      course: "AI Vibe Coding",
      language: "zh",
      durationDays: 1,
      listPriceMyr: "680.00",
      hrdc: 3,
      notHrdc: 7,
    },
    {
      course: "AI Agents Online Workshop",
      language: "en",
      durationDays: 1,
      listPriceMyr: "228.00",
      hrdc: 0,
      notHrdc: 4,
    },
    {
      course: "Unpriced Workshop",
      language: "en",
      durationDays: 1,
      listPriceMyr: null,
      hrdc: 1,
      notHrdc: 1,
    },
  ]);

  assert.deepEqual(
    rows.map((r) => [r.course, r.listPriceMyr, r.seats, r.hrdcShare]),
    [
      ["AI Agents Online Workshop", "228.00", 4, 0],
      ["AI Vibe Coding", "680.00", 20, 0.25],
    ],
  );
});
