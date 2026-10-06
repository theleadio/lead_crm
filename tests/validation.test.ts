import { test } from "node:test";
import assert from "node:assert/strict";
import { classCancelSchema } from "../lib/validation/class-cancel.ts";
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
