import { test } from "node:test";
import assert from "node:assert/strict";
import { classCancelSchema } from "../lib/validation/class-cancel.ts";
import {
  enrolmentCreateSchema,
  enrolmentStatusSchema,
  enrolmentTransferSchema,
} from "../lib/validation/enrolment.ts";
import { classNoticeEditSchema } from "../lib/validation/class-notice.ts";
import { personSchema } from "../lib/validation/person.ts";

test("personSchema requires full name", () => {
  const result = personSchema.safeParse({ fullName: "" });
  assert.equal(result.success, false);
});

test("personSchema rejects an invalid email but accepts a valid one", () => {
  assert.equal(
    personSchema.safeParse({ fullName: "Tan Mei Ling", email: "bad" }).success,
    false,
  );
  assert.equal(
    personSchema.safeParse({
      fullName: "Tan Mei Ling",
      email: "meiling@example.com",
    }).success,
    true,
  );
});

test("personSchema defaults preferredLanguage to en", () => {
  const result = personSchema.parse({ fullName: "Tan Mei Ling" });
  assert.equal(result.preferredLanguage, "en");
});

// Spec §9.10: a pending notice's wording may be corrected, never emptied.
test("classNoticeEditSchema refuses an empty message", () => {
  assert.equal(
    classNoticeEditSchema.safeParse({ messageEn: "" }).success,
    false,
  );
  assert.equal(
    classNoticeEditSchema.safeParse({ messageZh: "   " }).success,
    false,
  );
});

test("classNoticeEditSchema takes one message alone and trims it", () => {
  const result = classNoticeEditSchema.parse({ messageEn: "  Updated  " });
  assert.equal(result.messageEn, "Updated");
  assert.equal(result.messageZh, undefined);
});

test("classNoticeEditSchema needs at least one message", () => {
  assert.equal(classNoticeEditSchema.safeParse({}).success, false);
});

// Spec §7, §9.10: cancelling a class needs a reason.
test("classCancelSchema refuses an empty or whitespace reason", () => {
  assert.equal(classCancelSchema.safeParse({ reason: "" }).success, false);
  assert.equal(classCancelSchema.safeParse({ reason: "   " }).success, false);
  assert.equal(classCancelSchema.safeParse({}).success, false);
});

test("classCancelSchema trims the reason it keeps", () => {
  assert.equal(
    classCancelSchema.parse({ reason: "  Trainer unavailable  " }).reason,
    "Trainer unavailable",
  );
});

// Spec §9.11, §8.3, §12.4: what a create, a status change and a transfer may
// carry. A price never arrives from the client.
const CREATE = {
  personId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  classId: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
  status: "reserved" as const,
  payerType: "self" as const,
};

test("enrolmentCreateSchema refuses a status staff cannot create", () => {
  for (const status of ["confirmed", "completed", "waitlisted", "attended"])
    assert.equal(
      enrolmentCreateSchema.safeParse({ ...CREATE, status }).success,
      false,
      status,
    );
});

test("enrolmentCreateSchema takes the two staff statuses", () => {
  for (const status of ["reserved", "payment_pending"] as const)
    assert.equal(
      enrolmentCreateSchema.safeParse({ ...CREATE, status }).success,
      true,
      status,
    );
});

test("enrolmentCreateSchema drops an amount the client sent (§8.3)", () => {
  const parsed = enrolmentCreateSchema.parse({
    ...CREATE,
    pricePaidMyr: "1.00",
    amountMyr: "1.00",
  });
  assert.deepEqual(Object.keys(parsed).sort(), [
    "classId",
    "payerType",
    "personId",
    "status",
  ]);
});

test("enrolmentCreateSchema needs well-formed ids", () => {
  assert.equal(
    enrolmentCreateSchema.safeParse({ ...CREATE, personId: "nope" }).success,
    false,
  );
});

test("enrolmentStatusSchema requires a reason to cancel", () => {
  assert.equal(
    enrolmentStatusSchema.safeParse({ toStatus: "cancelled" }).success,
    false,
  );
  assert.equal(
    enrolmentStatusSchema.safeParse({ toStatus: "cancelled", reason: "   " })
      .success,
    false,
  );
  assert.equal(
    enrolmentStatusSchema.safeParse({
      toStatus: "cancelled",
      reason: "Student withdrew",
    }).success,
    true,
  );
});

test("enrolmentStatusSchema needs no reason for other moves", () => {
  assert.equal(
    enrolmentStatusSchema.safeParse({ toStatus: "confirmed" }).success,
    true,
  );
  assert.equal(
    enrolmentStatusSchema.safeParse({ toStatus: "nonsense" }).success,
    false,
  );
});

test("enrolmentTransferSchema needs a target class id", () => {
  assert.equal(enrolmentTransferSchema.safeParse({}).success, false);
  assert.equal(
    enrolmentTransferSchema.safeParse({ toClassId: CREATE.classId }).success,
    true,
  );
});
