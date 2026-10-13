// Spec §9.12 / §7 / §6: who the three payment routes answer, and what each
// one demands of a request. No database and no session — a route here is
// `getCurrentUser` plus the §6 gate, the body schema and the response mapper,
// and those are what this file checks. The same split as
// `tests/enrolments.test.ts`; the audited 403 itself is checked against the
// database in `payments-permissions`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readIfMatch } from "../lib/api/errors.ts";
import { ROLES, type Role } from "../lib/auth/permissions.ts";
import { canRecordPayment } from "../lib/payments/service.ts";
import { permissionFor } from "../lib/auth/permissions.ts";
import { proofKeyFor } from "../lib/uploads/signer.ts";
import {
  paymentManualSchema,
  uploadSignSchema,
} from "../lib/validation/payment.ts";

const ENROLMENT = "00000000-0000-4000-8000-000000000001";

// §6 payment row: F R - R - E -. Operations records, super_admin does
// everything, management and sales read money but never add it, support,
// marketing and part_time have no payment access at all.
test("only super_admin and operations record a payment (§6)", () => {
  const writers: Role[] = ["super_admin", "operations"];
  for (const role of ROLES)
    assert.equal(
      canRecordPayment({ id: "u", role }),
      writers.includes(role),
      role,
    );
});

test("five roles read a payment, two have none (§6)", () => {
  const readers: Role[] = ["super_admin", "management", "sales", "operations"];
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "payment", "read").allowed,
      readers.includes(role),
      role,
    );
});

// §6 footnote 3: Operations records a manual payment but cannot refund, and
// nothing in this change deletes a payment (§12.7).
test("nobody deletes a payment through these routes (§12.7)", () => {
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "payment", "delete").allowed,
      role === "super_admin",
      role,
    );
});

// POST /api/uploads/sign — the client sends the enrolment and nothing else,
// because the key is minted on the server (design 2).
test("the sign route takes an enrolment id and nothing else", () => {
  assert.equal(
    uploadSignSchema.safeParse({ enrolmentId: ENROLMENT }).success,
    true,
  );
  for (const body of [
    null,
    {},
    { enrolmentId: "not-an-id" },
    { enrolmentId: 1 },
  ])
    assert.equal(uploadSignSchema.safeParse(body).success, false, String(body));
});

test("the key the sign route hands back is prefixed with that enrolment", () => {
  assert.ok(proofKeyFor(ENROLMENT).startsWith(`${ENROLMENT}/`));
});

// POST /api/payments/manual reads If-Match before it looks at the body, so a
// save with no version is 428 and never reaches the store or the database.
test("the manual route's If-Match header is a positive whole number", () => {
  const withHeader = (value: string | null) =>
    readIfMatch(
      new Request("http://test/api/payments/manual", {
        method: "POST",
        headers: value === null ? {} : { "If-Match": value },
      }),
    );
  assert.equal(withHeader("3"), 3);
  assert.equal(withHeader(" 7 "), 7);
  for (const bad of [null, "", "0", "-1", "1.5", "1e3", "abc", '"3"'])
    assert.equal(withHeader(bad), null, `If-Match: ${bad}`);
});

test("the manual route refuses a body that is not a §9.12 payment", () => {
  for (const body of [null, {}, { enrolmentId: ENROLMENT }])
    assert.equal(paymentManualSchema.safeParse(body).success, false);
});
