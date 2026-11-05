import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClassSlot } from "../lib/import/class-slot.ts";

const paid = new Date("2026-10-28T00:00:00Z");
const slot = (start: string, end: string, language: "en" | "zh" | null, city: string | null) => ({ start, end, language, city });

test("English range with year and weekdays", () => {
  assert.deepEqual(parseClassSlot(["English Class - 11-12 November 2026 (Wed, Thurs) @ Oval Damansara"], paid), slot("2026-11-11", "2026-11-12", "en", null));
});
test("ampersand range, Chinese class", () => {
  assert.deepEqual(parseClassSlot(["Chinese Class - 14 & 15 November 2026 (Sat, Sun) @ AI365 Hub"], paid), slot("2026-11-14", "2026-11-15", "zh", null));
});
test("range without year, language in brackets", () => {
  assert.deepEqual(parseClassSlot(["17-18 October (English) @ AI365 Hub Oval Damansara"], new Date("2026-10-10T00:00:00Z")), slot("2026-10-17", "2026-10-18", "en", null));
});
test("price text wins over item text", () => {
  assert.deepEqual(parseClassSlot(["16 November (Mon) - English", "AI Vibe Coding Mastery｜23 Nov (Mon) | 9:00 AM"], paid), slot("2026-11-16", "2026-11-16", "en", null));
});
test("city after @", () => {
  assert.deepEqual(parseClassSlot(["23 October 2026 (Fri) @ Johor Bahru"], new Date("2026-10-20T00:00:00Z")), slot("2026-10-23", "2026-10-23", null, "Johor Bahru"));
});
test("date and language from the item when price has neither", () => {
  assert.deepEqual(parseClassSlot(["@ RM680", "Claude AI 实战课 (中文) | 28 November 2026 (Sat) | 9:00 AM"], paid), slot("2026-11-28", "2026-11-28", "zh", null));
});
test("Chinese date form implies zh", () => {
  assert.deepEqual(parseClassSlot(["@ RM228", "AI Agents 线上实作课｜10月13日(二)｜8:00PM-10:00PM"], new Date("2026-10-10T00:00:00Z")), slot("2026-10-13", "2026-10-13", "zh", null));
});
test("date inside HTML description", () => {
  assert.deepEqual(parseClassSlot(["@ 228", "AI Agents Online Workshop", "<p>Date: 20 Oct 2026</p>"], new Date("2026-10-14T00:00:00Z")), slot("2026-10-20", "2026-10-20", null, null));
});
test("YYYY年 M月 D号", () => {
  assert.deepEqual(parseClassSlot([null, undefined, "日期：2026年 11月 28号（六）"], paid), slot("2026-11-28", "2026-11-28", "zh", null));
});
test("year rolls over", () => {
  assert.deepEqual(parseClassSlot(["3 January (Sat) - English"], new Date("2026-12-28T00:00:00Z")), slot("2027-01-03", "2027-01-03", "en", null));
});
test("no date gives null", () => {
  assert.equal(parseClassSlot(["@ RM680", "Claude AI Mastery"], paid), null);
});
test("language from a later text when the dated text has none", () => {
  assert.equal(parseClassSlot(["20 Oct 2026", "Chinese Workshop"], paid)?.language, "zh");
});
test("decodes &amp; before parsing", () => {
  assert.deepEqual(parseClassSlot(["<b>14 &amp; 15 November 2026</b>"], paid), slot("2026-11-14", "2026-11-15", null, null));
});
test("a day the month does not have is no date", () => {
  assert.equal(parseClassSlot(["31 November 2026 (Mon) - English"], paid), null);
});
test("a range that ends before it starts is no date", () => {
  assert.equal(parseClassSlot(["30-1 December 2026"], paid), null);
});
test("range across two months", () => {
  assert.deepEqual(parseClassSlot(["30 November - 1 December 2026 (Mon, Tue) - English"], paid), slot("2026-11-30", "2026-12-01", "en", null));
  assert.deepEqual(parseClassSlot(["30 Nov – 1 Dec 2026"], paid), slot("2026-11-30", "2026-12-01", null, null));
  assert.deepEqual(parseClassSlot(["30 Dec - 2 Jan"], new Date("2026-12-20T00:00:00Z")), slot("2026-12-30", "2027-01-02", null, null));
});
test("only Johor Bahru counts as a city, canonical case", () => {
  assert.equal(parseClassSlot(["23 October 2026 @ Kuala Lumpur"], paid)?.city, null);
  assert.equal(parseClassSlot(["23 October 2026 @ johor bahru"], paid)?.city, "Johor Bahru");
});
