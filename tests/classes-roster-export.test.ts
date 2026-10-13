// Spec §9.10 Export CSV: the roster columns, and a value with a comma, a
// quote or a newline in it keeping the column count right. No database — the
// CSV shape is pure.
import test from "node:test";
import assert from "node:assert/strict";
import { enumLabel } from "../lib/classes/types.ts";
import { toCsv } from "../lib/format/csv.ts";

const HEADER = [
  "Name",
  "Status",
  "Holds a seat",
  "Payer",
  "Booked by",
  "Price paid (MYR)",
  "Reserved until",
  "Enrolled",
];

// One CSV record, counting the commas outside quotes (what a spreadsheet does).
function columns(line: string): number {
  let count = 1;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) count++;
  }
  return count;
}

test("the roster CSV header carries the §9.10 columns", () => {
  const [line] = toCsv(HEADER, []).split("\r\n");
  assert.equal(columns(line), 8);
  assert.match(line, /^Name,Status,Holds a seat/);
  assert.ok(!/Phone|Email/i.test(line), "no contact details in the roster");
});

test("a comma, a quote and a newline keep the column count", () => {
  const csv = toCsv(HEADER, [
    [
      'Tan "Mei" Ling, Jr\nSecond line',
      "Confirmed",
      "Yes",
      "Company",
      "HR, Officer",
      "1800.00",
      null,
      "06 Oct 2026",
    ],
  ]);
  // The row holds a newline, so count the records by quote parity, not lines.
  const record = csv.slice(csv.indexOf("\r\n") + 2);
  assert.equal(columns(record), 8);
  assert.match(record, /"Tan ""Mei"" Ling, Jr\r?\nSecond line"/);
  assert.match(record, /"HR, Officer"/);
});

test("an enum reads as words in the export", () => {
  assert.equal(enumLabel("payment_pending"), "Payment pending");
  assert.equal(enumLabel("no_show"), "No show");
  assert.equal(enumLabel("self"), "Self");
});
