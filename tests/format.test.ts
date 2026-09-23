import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneE164 } from "../lib/format/phone.ts";
import { isValidEmail, normalizeEmail } from "../lib/format/email.ts";
import { formatMoneyMyr } from "../lib/format/money.ts";
import { formatDate, formatTime } from "../lib/format/date.ts";

// Spec §4 phone table — every shape must normalise to the same E.164 number.
test("normalizePhoneE164 handles every shape in the spec table", () => {
  const expected = "+60123456789";
  assert.equal(normalizePhoneE164("012-345 6789"), expected);
  assert.equal(normalizePhoneE164("0123456789"), expected);
  assert.equal(normalizePhoneE164("60123456789"), expected);
  assert.equal(normalizePhoneE164("+60 12-345 6789"), expected);
});

test("normalizePhoneE164 returns null for unnormalisable input", () => {
  assert.equal(normalizePhoneE164("not a phone number"), null);
});

test("isValidEmail rejects missing @ and missing dot in domain", () => {
  assert.equal(isValidEmail("meiling@example.com"), true);
  assert.equal(isValidEmail("meiling@examplecom"), false);
  assert.equal(isValidEmail("meilingexample.com"), false);
  assert.equal(isValidEmail("a@b@example.com"), false);
});

test("normalizeEmail lowercases and trims", () => {
  assert.equal(
    normalizeEmail("  Mei.Ling@Example.COM  "),
    "mei.ling@example.com",
  );
});

test("formatMoneyMyr matches spec display format", () => {
  assert.equal(formatMoneyMyr(3200), "RM3,200.00");
  assert.equal(formatMoneyMyr("3200"), "RM3,200.00");
  assert.equal(formatMoneyMyr(0), "RM0.00");
});

test("formatDate and formatTime match spec §4 examples", () => {
  const d = new Date("2026-09-22T01:00:00Z"); // 9:00am MYT
  assert.equal(formatDate(d), "22 Sep 2026");
  assert.equal(formatTime(d), "9:00am");
});
