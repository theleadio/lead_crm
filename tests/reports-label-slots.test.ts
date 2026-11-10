// §9.18 efficiency map: chart labels never sit on each other, on a point, on
// fixed text, on the x-axis figures or off the chart (browser check, 10 Nov;
// review of #56).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_CHAR,
  LABEL_LINE,
  MAX_STEPS,
  labelSlots,
  textBox,
} from "../app/(app)/(crm)/reports/ads/panels/label-slots.ts";

const bounds = { floor: 300, ceiling: 10, left: 0, right: 760 };
// A point at x = 100 whose label starts at 110 on the right, ends at 90 on
// the left.
const at = (x: number) => ({ right: x + 10, left: x - 10 });

test("a label with room stays on the right of its point", () => {
  const slot = labelSlots(bounds);
  assert.deepEqual(slot(at(100), 200, 20), { side: "right", dy: 0 });
});

test("two labels on the baseline: the second moves up, never down past the floor", () => {
  const slot = labelSlots(bounds);
  assert.deepEqual(slot(at(100), 296, 37), { side: "right", dy: 0 });
  const s = slot(at(150), 296, 40);
  assert.ok(s);
  assert.ok(296 + s.dy <= bounds.floor);
  assert.notDeepEqual(s, { side: "right", dy: 0 });
});

test("labels side by side on one line do not move", () => {
  const slot = labelSlots(bounds);
  assert.deepEqual(slot(at(0), 200, 10), { side: "right", dy: 0 });
  assert.deepEqual(slot(at(100), 200, 10), { side: "right", dy: 0 });
});

test("a long name is measured wide enough to clash with its neighbour", () => {
  const slot = labelSlots(bounds);
  slot(at(100), 200, 40);
  // 40 characters from x = 110 reach past x = 330.
  assert.notDeepEqual(slot(at(300), 200, 10), { side: "right", dy: 0 });
});

test("a label does not cover another point or fixed text", () => {
  const point = { left: 140, right: 150, top: 190, bottom: 200 };
  const guide = textBox(110, 110 + 13 * LABEL_CHAR, 188);
  assert.notDeepEqual(labelSlots(bounds, [point])(at(100), 200, 20), {
    side: "right",
    dy: 0,
  });
  assert.notDeepEqual(labelSlots(bounds, [guide])(at(100), 188, 20), {
    side: "right",
    dy: 0,
  });
});

test("a label that would run off the right edge goes on the left", () => {
  const slot = labelSlots(bounds);
  // 37 characters from x = 668 would end near 883, past 760.
  assert.deepEqual(slot(at(658), 200, 37), { side: "left", dy: 0 });
});

test("a label never rises above the ceiling", () => {
  const slot = labelSlots(bounds);
  assert.deepEqual(slot(at(100), 30, 20), { side: "right", dy: 0 });
  // The same line is taken on both sides; up would cross the ceiling.
  slot(at(300), 30, 60);
  const s = slot(at(110), 30, 20);
  assert.ok(s === null || 30 + s.dy - LABEL_LINE + 3 >= bounds.ceiling);
});

test("a label with no room near its point is left off, not moved far away", () => {
  const slot = labelSlots(bounds);
  // Fill every line within reach of y = 200 on both sides.
  for (let k = -MAX_STEPS; k <= MAX_STEPS; k++) {
    slot(at(100), 200 + k * LABEL_LINE, 20);
    slot({ right: 0, left: 90 }, 200 + k * LABEL_LINE, 15);
  }
  assert.equal(slot(at(100), 200, 20), null);
});
