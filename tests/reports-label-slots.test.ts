// §9.18 efficiency map: chart labels never sit on each other or on the
// x-axis figures (browser check, 10 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_LINE,
  MAX_STEPS,
  labelSlots,
} from "../app/(app)/(crm)/reports/ads/panels/label-slots.ts";

const bounds = { floor: 300, ceiling: 0 };

test("a label with room stays on its point", () => {
  const slot = labelSlots(bounds);
  assert.equal(slot(100, 200, 20), 0);
});

test("two labels on the baseline: the second moves up, never down past the floor", () => {
  const slot = labelSlots(bounds);
  assert.equal(slot(100, 296, 37), 0);
  // Starts inside the first label's box on the same baseline.
  const dy = slot(150, 296, 40);
  assert.equal(dy, -LABEL_LINE);
  assert.ok(296 + dy <= bounds.floor);
});

test("labels side by side on one line do not move", () => {
  const slot = labelSlots(bounds);
  assert.equal(slot(0, 200, 10), 0);
  assert.equal(slot(100, 200, 10), 0);
});

test("a long name is measured wide enough to clash with its neighbour", () => {
  const slot = labelSlots(bounds);
  slot(100, 200, 40);
  // 40 characters reach past x = 300, so a label starting at 300 clashes.
  assert.notEqual(slot(300, 200, 10), 0);
});

test("near the top, a clash moves down instead of off the chart", () => {
  const slot = labelSlots(bounds);
  assert.equal(slot(100, 14, 20), 0);
  assert.equal(slot(110, 14, 20), LABEL_LINE);
});

test("a label does not cover another point", () => {
  // A point sits right where the label would start on its own line.
  const slot = labelSlots(bounds, [
    { left: 140, right: 150, top: 190, bottom: 200 },
  ]);
  assert.notEqual(slot(100, 200, 20), 0);
});

test("a label with no room near its point is left off, not moved far away", () => {
  const slot = labelSlots(bounds);
  // Fill every line within reach of y = 200.
  for (let k = -MAX_STEPS; k <= MAX_STEPS; k++)
    slot(100, 200 + k * LABEL_LINE, 20);
  assert.equal(slot(100, 200, 20), null);
});
