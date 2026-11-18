// Spec §9.15 Lost reasons: the §7.1 create, update and reorder bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lostReasonCreateSchema,
  lostReasonReorderSchema,
  lostReasonUpdateSchema,
} from "../lib/validation/lost-reason.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

// --- lost reasons (4.1) ---------------------------------------------------

test("lost reason create: code is lowercase letters, digits, underscores", () => {
  const ok = lostReasonCreateSchema.safeParse({
    code: "budget_frozen",
    labelEn: " Budget frozen ",
  });
  assert.ok(ok.success);
  assert.equal(ok.data.labelEn, "Budget frozen");
  assert.equal(ok.data.labelZh, null);
  for (const code of ["Budget", "budget-frozen", "", "a b"])
    assert.equal(
      lostReasonCreateSchema.safeParse({ code, labelEn: "x" }).success,
      false,
      code,
    );
});

test("lost reason create: English label can't be blank, Chinese is optional", () => {
  assert.equal(
    lostReasonCreateSchema.safeParse({ code: "x", labelEn: "  " }).success,
    false,
  );
  const zh = lostReasonCreateSchema.safeParse({
    code: "x",
    labelEn: "X",
    labelZh: "预算",
  });
  assert.equal(zh.data?.labelZh, "预算");
  // An emptied Chinese box clears it.
  const blank = lostReasonCreateSchema.safeParse({
    code: "x",
    labelEn: "X",
    labelZh: " ",
  });
  assert.equal(blank.data?.labelZh, null);
});

test("lost reason update: labels and active only; a code is refused", () => {
  assert.ok(lostReasonUpdateSchema.safeParse({ labelEn: "Price" }).success);
  assert.ok(lostReasonUpdateSchema.safeParse({ labelZh: null }).success);
  assert.ok(lostReasonUpdateSchema.safeParse({ isActive: false }).success);
  assert.equal(
    lostReasonUpdateSchema.safeParse({ code: "price2", labelEn: "Price" })
      .success,
    false,
  );
  assert.equal(lostReasonUpdateSchema.safeParse({}).success, false);
  assert.equal(lostReasonUpdateSchema.safeParse({ labelEn: "" }).success, false);
});

test("lost reason reorder: a non-empty list of ids", () => {
  assert.ok(lostReasonReorderSchema.safeParse({ ids: [ID, ID2] }).success);
  assert.equal(lostReasonReorderSchema.safeParse({ ids: [] }).success, false);
  assert.equal(
    lostReasonReorderSchema.safeParse({ ids: ["abc"] }).success,
    false,
  );
});

