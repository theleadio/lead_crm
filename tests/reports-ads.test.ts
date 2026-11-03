// §9.18 ads report: everything about it that needs no database. The date
// range is a pure schema, and the Meta allow-lists are plain data. How the
// predicate actually classifies a row, and how the rows are ordered and
// capped, live in SQL — those are asserted in reports-ads-db.test.ts against
// real touchpoints, because a second TypeScript copy of the predicate would
// be a second definition that could drift from the one that counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillWeeks, META_CHANNELS, META_SOURCES } from "../lib/reports/ads.ts";
import { SPEND_UNAVAILABLE, NO_SPEND } from "../lib/reports/types.ts";
import {
  adsReportQuerySchema,
  defaultRange,
  kualaLumpurDay,
  MAX_RANGE_DAYS,
} from "../lib/validation/report.ts";

const range = (from?: string, to?: string) =>
  adsReportQuerySchema.safeParse({ from, to });

test("ads report: the default range is the last 30 Kuala Lumpur days", () => {
  // 29 Oct 2026, 23:30 UTC is already 30 Oct in Kuala Lumpur (UTC+8).
  const at = new Date("2026-10-29T23:30:00Z");
  assert.equal(kualaLumpurDay(at), "2026-10-30");
  // 30 days counting both ends, so the window is 30 days of data, not 31.
  assert.deepEqual(defaultRange(at), {
    from: "2026-10-01",
    to: "2026-10-30",
  });

  const parsed = range();
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data, defaultRange());
});

test("ads report: a valid range is taken as given", () => {
  const parsed = range("2026-10-01", "2026-10-07");
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data, { from: "2026-10-01", to: "2026-10-07" });
});

test("ads report: one date given, the other falls back to the default", () => {
  const parsed = range("2026-10-01");
  assert.ok(parsed.success);
  assert.equal(parsed.data.from, "2026-10-01");
  assert.equal(parsed.data.to, defaultRange().to);
});

test("ads report: a single day is a range", () => {
  const parsed = range("2026-10-07", "2026-10-07");
  assert.ok(parsed.success);
});

// A bad range is refused with no counts shown, never corrected: a silently
// swapped or widened range is a wrong number the viewer cannot see is wrong.
test("ads report: a backwards range is refused, not swapped", () => {
  const parsed = range("2026-10-08", "2026-10-07");
  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues[0]!.message, /after the end date/);
});

test("ads report: a non-date is refused", () => {
  for (const bad of ["yesterday", "2026-13-01", "01/10/2026", "2026-10-7"])
    assert.equal(range(bad, "2026-10-30").success, false, bad);
});

test("ads report: a range over the cap is refused", () => {
  // 400 days counting both ends is the last range accepted.
  const start = new Date("2026-10-30T00:00:00Z");
  const day = (back: number) =>
    new Date(start.getTime() - back * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  assert.equal(range(day(MAX_RANGE_DAYS - 1), "2026-10-30").success, true);
  assert.equal(range(day(MAX_RANGE_DAYS), "2026-10-30").success, false);
});

// O63's allow-lists, written down. A decision that organic Instagram is not a
// paid-ads lead changes this list and the SQL that reads it, nothing else.
test("ads report: the Meta allow-lists are the O63 definition", () => {
  assert.deepEqual([...META_CHANNELS], ["lead_form", "ctwa"]);
  assert.deepEqual(
    [...META_SOURCES],
    ["facebook", "instagram", "fb", "ig", "meta"],
  );
});

// Spend is null, never zero: a zero reads as a campaign that cost nothing,
// and a cost per lead divided from it would be a number nobody recorded.
test("ads report: every spend field is null until the ad data exists", () => {
  assert.deepEqual(NO_SPEND, {
    spendMyr: null,
    impressions: null,
    clicks: null,
    costPerLeadMyr: null,
  });
  for (const value of Object.values(NO_SPEND)) assert.notEqual(value, 0);
  assert.match(SPEND_UNAVAILABLE, /nothing here is estimated/);
});

// §9.18 leads per week: the week walk is pure, so the gap-filling and the
// Monday arithmetic are checked without a database.
test("weeks: a week with no leads is a zero, not a missing column", () => {
  const q = adsReportQuerySchema.parse({
    from: "2026-09-01",
    to: "2026-09-28",
  });
  // Only the third week has leads.
  const filled = fillWeeks(
    [{ weekStart: "2026-09-14", total: 3, byChannel: { ctwa: 3 } }],
    q,
    ["ctwa"],
  );
  assert.deepEqual(
    filled.map((w) => [w.weekStart, w.total]),
    [
      ["2026-08-31", 0],
      ["2026-09-07", 0],
      ["2026-09-14", 3],
      ["2026-09-21", 0],
      // 28 Sep is itself a Monday, so the range's last day opens a week.
      ["2026-09-28", 0],
    ],
  );
  // A filled week still carries every channel, so the table has no holes.
  assert.deepEqual(filled[0]!.byChannel, { ctwa: 0 });
});

test("weeks: every week starts on a Monday", () => {
  const q = adsReportQuerySchema.parse({
    from: "2026-10-04",
    to: "2026-10-29",
  });
  for (const w of fillWeeks([], q, [])) {
    const day = new Date(`${w.weekStart}T00:00:00Z`).getUTCDay();
    assert.equal(day, 1, `${w.weekStart} is not a Monday`);
  }
});

// A range inside one week is one column, not none.
test("weeks: a range inside a single week is one week", () => {
  const q = adsReportQuerySchema.parse({
    from: "2026-10-27",
    to: "2026-10-29",
  });
  const weeks = fillWeeks([], q, []);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0]!.weekStart, "2026-10-26");
});
