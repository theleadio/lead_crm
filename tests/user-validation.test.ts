// Spec §9.15 Users: the PATCH /api/users/:id body (§7). The add-user body is phase 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { userUpdateSchema } from "../lib/validation/user.ts";

// --- users (2.1, update only; the add schema is phase 2) -----------------

test("user update: one of the seven roles, and nothing else", () => {
  assert.ok(userUpdateSchema.safeParse({ roleCode: "operations" }).success);
  const bad = userUpdateSchema.safeParse({ roleCode: "admin" });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.error?.issues[0].path, ["roleCode"]);
});

test("user update: active flag; employment type is no longer accepted", () => {
  assert.equal(
    userUpdateSchema.safeParse({ employmentType: "part_time" }).success,
    false,
  );
  assert.ok(userUpdateSchema.safeParse({ isActive: false }).success);
  assert.equal(userUpdateSchema.safeParse({ isActive: "no" }).success, false);
});

test("user update: an empty patch or an unknown field is refused", () => {
  assert.equal(userUpdateSchema.safeParse({}).success, false);
  assert.equal(
    userUpdateSchema.safeParse({ roleCode: "sales", email: "x@y.z" }).success,
    false,
  );
  assert.equal(userUpdateSchema.safeParse(null).success, false);
});

