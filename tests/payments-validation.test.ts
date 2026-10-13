// Spec §9.12: every field required except notes; amount above zero with at
// most two decimals; a date that is not in the future; Stripe methods refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentManualSchema } from "../lib/validation/payment.ts";

const ENROLMENT = "00000000-0000-4000-8000-000000000001";

const valid = {
  enrolmentId: ENROLMENT,
  method: "bank_transfer",
  amountMyr: "3200.00",
  referenceNo: "FT24100912345",
  paidOn: "2026-10-08",
  proofKey: `${ENROLMENT}/0196f0a0-0000-4000-8000-000000000abc`,
  notes: "Paid from the company account",
};

// The distinct fields the issues are reported against, so the modal can
// highlight them (§9 cross-screen: field-level errors). Distinct because one
// value can break two rules at once — "" fails the shape and the above-zero
// test — and the field it belongs to is what the form needs.
const fieldsOf = (body: unknown): string[] => {
  const parsed = paymentManualSchema.safeParse(body);
  assert.equal(parsed.success, false, "expected this body to be refused");
  return [
    ...new Set(parsed.error!.issues.map((issue) => issue.path.join("."))),
  ];
};

test("a complete body parses", () => {
  const parsed = paymentManualSchema.safeParse(valid);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.amountMyr, "3200.00");
  assert.equal(parsed.data!.method, "bank_transfer");
});

test("every field but notes is required", () => {
  for (const field of [
    "enrolmentId",
    "method",
    "amountMyr",
    "referenceNo",
    "paidOn",
    "proofKey",
  ]) {
    const body: Record<string, unknown> = { ...valid };
    delete body[field];
    assert.deepEqual(fieldsOf(body), [field], `${field} should be required`);
  }
});

test("notes are optional", () => {
  const { notes, ...withoutNotes } = valid;
  assert.equal(notes.length > 0, true);
  const parsed = paymentManualSchema.safeParse(withoutNotes);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.notes, undefined);
});

test("a Stripe method cannot be recorded by hand", () => {
  for (const method of ["stripe_card", "stripe_fpx"]) {
    assert.deepEqual(fieldsOf({ ...valid, method }), ["method"]);
  }
});

test("the amount must be above zero with at most two decimals", () => {
  for (const amountMyr of [
    "0",
    "0.00",
    "0000.00",
    "-100",
    "3200.005",
    "3,200.00",
    "RM3200",
    "",
  ]) {
    assert.deepEqual(
      fieldsOf({ ...valid, amountMyr }),
      ["amountMyr"],
      `${amountMyr} should be refused`,
    );
  }
});

test("the amount keeps its exact decimals", () => {
  for (const amountMyr of ["1234.55", "3200", "0.01", "9999999999.99"]) {
    const parsed = paymentManualSchema.safeParse({ ...valid, amountMyr });
    assert.equal(parsed.success, true, `${amountMyr} should be accepted`);
    assert.equal(parsed.data!.amountMyr, amountMyr);
  }
});

test("a payment cannot be dated in the future", () => {
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  assert.deepEqual(fieldsOf({ ...valid, paidOn: tomorrow }), ["paidOn"]);
  assert.deepEqual(fieldsOf({ ...valid, paidOn: "09/10/2026" }), ["paidOn"]);
});

test("today is a valid payment date", () => {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const parsed = paymentManualSchema.safeParse({ ...valid, paidOn: today });
  assert.equal(parsed.success, true);
});

test("an empty reference number is refused", () => {
  for (const referenceNo of ["", "   "]) {
    assert.deepEqual(fieldsOf({ ...valid, referenceNo }), ["referenceNo"]);
  }
});

// §9.12 One invoice, several students: ten payments share one reference. The
// body carries no uniqueness rule at all, and nothing here looks the reference
// up (task 2.2).
test("two payments may carry the same reference number", () => {
  const shared = "INV-2026-0042";
  for (const enrolmentId of [
    ENROLMENT,
    "00000000-0000-4000-8000-000000000002",
  ]) {
    const parsed = paymentManualSchema.safeParse({
      ...valid,
      enrolmentId,
      referenceNo: shared,
      proofKey: `${enrolmentId}/0196f0a0-0000-4000-8000-00000000000a`,
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.referenceNo, shared);
  }
});

test("a proof key that climbs out of its folder is refused", () => {
  for (const proofKey of ["", "../other/slip.pdf", "/etc/passwd"]) {
    assert.deepEqual(fieldsOf({ ...valid, proofKey }), ["proofKey"]);
  }
});

test("values are trimmed before they are stored", () => {
  const parsed = paymentManualSchema.safeParse({
    ...valid,
    referenceNo: "  FT123  ",
    notes: "  by hand  ",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.referenceNo, "FT123");
  assert.equal(parsed.data!.notes, "by hand");
});
