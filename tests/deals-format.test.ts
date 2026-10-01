// Spec §9.5 card aging (amber >7, red >14; won/lost never aged).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMyr,
  agingTone,
  daysInStage,
  initials,
} from "../lib/deals/format.ts";

const now = new Date(2026, 8, 28, 9, 0); // 28 Sep 2026, 9am local
const ago = (days: number, hour = 9) =>
  new Date(2026, 8, 28 - days, hour, 0).toISOString();

test("days in stage counts local calendar days", () => {
  assert.equal(daysInStage(ago(0), now), 0);
  assert.equal(daysInStage(ago(1, 23), now), 1); // 10 hours ago, yesterday
  assert.equal(daysInStage(ago(15), now), 15);
  assert.equal(daysInStage(new Date(2026, 8, 29).toISOString(), now), 0);
});

test("aging colors at 0, 7, 8, 14 and 15 days", () => {
  const tone = (d: number) => agingTone("qualified", d);
  assert.equal(tone(0), "none");
  assert.equal(tone(7), "none");
  assert.equal(tone(8), "amber");
  assert.equal(tone(14), "amber");
  assert.equal(tone(15), "red");
});

test("won and lost are never aged", () => {
  assert.equal(agingTone("won", 30), "none");
  assert.equal(agingTone("lost", 30), "none");
});

test("optimistic totals add and subtract in whole sen", () => {
  assert.equal(addMyr("0.10", "0.20", 1), "0.30");
  assert.equal(addMyr("3200.00", "3200.00", -1), "0.00");
  assert.equal(addMyr("5.00", null, 1), "5.00");
});

test("initials use first and last name", () => {
  assert.equal(initials("Tan Mei Ling"), "TL");
  assert.equal(initials("wei"), "W");
});
