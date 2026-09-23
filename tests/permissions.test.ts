import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canExportPeople,
  masksContactDetails,
  mergeAccess,
  permissionFor,
  PermissionError,
  requirePermission,
} from "../lib/auth/permissions.ts";
import { maskEmail, maskPhone } from "../lib/format/mask.ts";
import { findDuplicate } from "../lib/people/dedupe.ts";

const as = (role: Parameters<typeof permissionFor>[0]["role"]) => ({
  id: "me",
  role,
});

// Spec §15.2: permission checks per role are a must-have automated test.
test("person: sales/support edit, management/marketing/operations read only", () => {
  assert.equal(permissionFor(as("sales"), "person", "write").allowed, true);
  assert.equal(permissionFor(as("support"), "person", "write").allowed, true);
  assert.equal(
    permissionFor(as("management"), "person", "write").allowed,
    false,
  );
  assert.equal(permissionFor(as("marketing"), "person", "read").allowed, true);
  assert.equal(
    permissionFor(as("marketing"), "person", "write").allowed,
    false,
  );
  assert.equal(permissionFor(as("sales"), "person", "delete").allowed, false);
  assert.equal(
    permissionFor(as("super_admin"), "person", "delete").allowed,
    true,
  );
});

test("part_time only reaches assigned people", () => {
  assert.deepEqual(permissionFor(as("part_time"), "person", "read"), {
    allowed: true,
    assignedOnly: true,
  });
  assert.throws(
    () =>
      requirePermission(as("part_time"), "person", "read", {
        recordOwnerId: "someone-else",
      }),
    PermissionError,
  );
  assert.doesNotThrow(() =>
    requirePermission(as("part_time"), "person", "read", {
      recordOwnerId: "me",
    }),
  );
});

test("no-access cells throw", () => {
  assert.throws(
    () => requirePermission(as("marketing"), "enrolment", "read"),
    PermissionError,
  );
  assert.throws(
    () => requirePermission(as("part_time"), "deal", "read"),
    PermissionError,
  );
  assert.throws(
    () => requirePermission(as("management"), "settings", "read"),
    PermissionError,
  );
});

test("export, masking and merge follow the matrix footnotes", () => {
  assert.equal(canExportPeople("super_admin"), true);
  assert.equal(canExportPeople("management"), false);
  assert.equal(canExportPeople("marketing"), false);
  assert.equal(masksContactDetails("marketing"), true);
  assert.equal(masksContactDetails("sales"), false);
  assert.equal(mergeAccess("super_admin"), "full");
  assert.equal(mergeAccess("sales"), "propose");
  assert.equal(mergeAccess("marketing"), "none");
});

test("masking matches the spec examples", () => {
  assert.equal(maskPhone("012-345 6789"), "012-•••• 6789");
  assert.equal(maskPhone("+60123456789"), "012-•••• 6789");
  assert.equal(maskPhone("12345"), "••••");
  assert.equal(maskPhone(null), null);
  assert.equal(maskEmail("siti@gmail.com"), "s••••@gmail.com");
  assert.equal(maskEmail(null), null);
});

// Spec §15.2: duplicate detection is a must-have automated test.
const existing = [
  {
    id: "a",
    fullName: "Tan Wei Ming",
    emailNorm: "wm@example.com",
    phoneE164: "+60123456789",
    companyName: "Acme Sdn Bhd",
  },
  {
    id: "b",
    fullName: "Tan Wei Ming",
    emailNorm: null,
    phoneE164: null,
    companyName: null,
  },
];

test("dedupe: same email or phone is a hard match", () => {
  const byEmail = findDuplicate(
    {
      fullName: "Someone",
      emailNorm: "wm@example.com",
      phoneE164: null,
      companyName: null,
    },
    existing,
  );
  assert.equal(byEmail.kind, "hard");
  const byPhone = findDuplicate(
    {
      fullName: "Someone",
      emailNorm: null,
      phoneE164: "+60123456789",
      companyName: null,
    },
    existing,
  );
  assert.deepEqual(byPhone.kind === "hard" && [byPhone.match.id, byPhone.on], [
    "a",
    "phone",
  ]);
});

test("dedupe: same name + same company is a soft match", () => {
  const r = findDuplicate(
    {
      fullName: "tan  wei ming",
      emailNorm: null,
      phoneE164: null,
      companyName: "ACME SDN BHD",
    },
    existing,
  );
  assert.equal(r.kind === "soft" && r.match.id, "a");
});

test("dedupe: never matches on name alone", () => {
  const r = findDuplicate(
    {
      fullName: "Tan Wei Ming",
      emailNorm: null,
      phoneE164: null,
      companyName: null,
    },
    existing,
  );
  assert.equal(r.kind, "none");
});
