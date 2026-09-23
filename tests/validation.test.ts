import { test } from "node:test";
import assert from "node:assert/strict";
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
