// Spec §9.15 Tags: the §7.1 PATCH and merge bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tagMergeSchema, tagUpdateSchema } from "../lib/validation/tag.ts";

const ID = "00000000-0000-4000-8000-000000000001";

// --- tags (5.1) -------------------------------------------------------------

test("tag update: name is trimmed and can't be blank", () => {
  const ok = tagUpdateSchema.safeParse({ name: "  VIP " });
  assert.equal(ok.data?.name, "VIP");
  assert.equal(tagUpdateSchema.safeParse({ name: "   " }).success, false);
  assert.ok(tagUpdateSchema.safeParse({ isActive: false }).success);
});

test("tag update: strict, and at least one field", () => {
  assert.equal(tagUpdateSchema.safeParse({}).success, false);
  assert.equal(
    tagUpdateSchema.safeParse({ name: "x", isSystem: false }).success,
    false,
  );
});

test("tag merge: intoTagId is an id", () => {
  assert.ok(tagMergeSchema.safeParse({ intoTagId: ID }).success);
  assert.equal(tagMergeSchema.safeParse({ intoTagId: "vip" }).success, false);
  assert.equal(tagMergeSchema.safeParse({}).success, false);
});
