// Spec §9.12 Amount: any amount above zero is accepted, and the modal notes a
// difference from `price_paid_myr`. This is the comparison behind that note —
// decimal strings in whole cents, never a float (§12.7). It reports a
// difference only; the outstanding balance across an enrolment's payments
// belongs to O16 and arrives with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoneyMyr, sameMoney } from "../lib/format/money.ts";

test("the same amount written differently does not warn", () => {
  for (const [entered, stored] of [
    ["3200", "3200.00"],
    ["3200.00", "3200"],
    [" 3200.0 ", "3200.00"],
    ["0.10", "0.1"],
    ["1234.55", "1234.55"],
  ] as const) {
    assert.equal(sameMoney(entered, stored), true, `${entered} vs ${stored}`);
  }
});

test("a part payment and an overpayment both warn", () => {
  assert.equal(sameMoney("100.00", "3200.00"), false);
  assert.equal(sameMoney("5000.00", "3200.00"), false);
  // One cent apart is still a difference — this is money (§12.7).
  assert.equal(sameMoney("3200.01", "3200.00"), false);
});

test("no stored price means nothing to compare, so no note", () => {
  for (const stored of [null, undefined, "", "   "]) {
    assert.equal(sameMoney("3200.00", stored), true, String(stored));
  }
});

test("the note names both numbers the way §4 renders money", () => {
  assert.equal(formatMoneyMyr("100.00"), "RM100.00");
  assert.equal(formatMoneyMyr("3200"), "RM3,200.00");
});

// 0.1 + 0.2 is the reason this goes through whole cents (§12.7).
test("the comparison does not drift the way a float would", () => {
  assert.equal(sameMoney("0.30", "0.3"), true);
  assert.equal(sameMoney("0.30000000000000004", "0.3"), true);
});
