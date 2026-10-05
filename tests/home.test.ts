// Spec §9.0 Home, the parts that need no database: which stages the deals
// panel keeps, how its money is added (§4, §12.7), and the ten-row cap on
// the task panel.
import test from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../lib/deals/types.ts";
import { formatOverdue } from "../lib/format/date.ts";
import { sumMyr } from "../lib/format/money.ts";
import { openStageTotals, summariseTasks } from "../lib/home/service.ts";
import type { HomeTask } from "../lib/home/types.ts";

const totalsFor = (pipeline: "individual" | "corporate") =>
  STAGES[pipeline].map((stage, i) => ({
    stage,
    count: i + 1,
    totalMyr: `${(i + 1) * 100}.50`,
  }));

test("won and lost are not open work", () => {
  const totals = openStageTotals("individual", totalsFor("individual"));
  assert.deepEqual(
    totals.stages.map((s) => s.stage),
    ["new", "engaged", "qualified", "checkout_sent"],
  );
  // counts 1..4, values 100.50 + 200.50 + 300.50 + 400.50
  assert.equal(totals.openCount, 10);
  assert.equal(totals.openTotalMyr, "1002.00");
});

test("each pipeline keeps its own stages", () => {
  const totals = openStageTotals("corporate", totalsFor("corporate"));
  assert.deepEqual(
    totals.stages.map((s) => s.stage),
    ["new", "discovery", "proposal_sent", "funding"],
  );
});

test("an empty stage is still listed, at zero", () => {
  const totals = openStageTotals("individual", [
    { stage: "new", count: 0, totalMyr: "0.00" },
    { stage: "engaged", count: 0, totalMyr: "0.00" },
    { stage: "qualified", count: 0, totalMyr: "0.00" },
    { stage: "checkout_sent", count: 0, totalMyr: "0.00" },
    { stage: "won", count: 9, totalMyr: "9000.00" },
    { stage: "lost", count: 4, totalMyr: "4000.00" },
  ]);
  assert.equal(totals.stages.length, 4);
  assert.deepEqual(totals.stages[2], {
    stage: "qualified",
    count: 0,
    totalMyr: "0.00",
  });
  assert.equal(totals.openTotalMyr, "0.00");
  assert.equal(totals.openCount, 0);
});

test("money stays a decimal string and never drifts", () => {
  // 0.1 + 0.2 in floating point is 0.30000000000000004.
  assert.equal(sumMyr(["0.10", "0.20"]), "0.30");
  assert.equal(sumMyr(["1234567.89", "0.11"]), "1234568.00");
  assert.equal(sumMyr([]), "0.00");
  assert.equal(sumMyr(["100.00", "-20.50"]), "79.50");
  const totals = openStageTotals("individual", totalsFor("individual"));
  for (const stage of totals.stages)
    assert.equal(typeof stage.totalMyr, "string");
});

const task = (i: number, isOverdue: boolean): HomeTask => ({
  id: `t${i}`,
  type: "call",
  title: `Task ${i}`,
  who: null,
  href: null,
  dueAt: new Date(2026, 9, 5, 9, 0).toISOString(),
  isOverdue,
});

test("ten rows shown, the rest counted", () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => task(i, true)),
    ...Array.from({ length: 5 }, (_, i) => task(10 + i, false)),
  ];
  const summary = summariseTasks(rows);
  assert.equal(summary.tasks.length, 10);
  assert.equal(summary.moreCount, 1);
  assert.equal(summary.overdueCount, 6);
  assert.equal(summary.todayCount, 5);
});

test("ten or fewer rows: nothing left over", () => {
  const summary = summariseTasks([task(1, true), task(2, false)]);
  assert.equal(summary.moreCount, 0);
  assert.equal(summary.tasks.length, 2);
});

test("overdue reads in the largest honest unit", () => {
  const now = new Date("2026-10-05T12:00:00+08:00");
  assert.equal(formatOverdue("2026-10-03T12:00:00+08:00", now), "2 days late");
  assert.equal(formatOverdue("2026-10-04T12:00:00+08:00", now), "1 day late");
  assert.equal(formatOverdue("2026-10-05T07:00:00+08:00", now), "5 hours late");
  assert.equal(formatOverdue("2026-10-05T11:30:00+08:00", now), "due now");
});
