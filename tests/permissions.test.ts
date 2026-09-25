import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAddPersonStandalone,
  canExportPeople,
  masksContactDetails,
  mergeAccess,
  permissionFor,
  PermissionError,
  requirePermission,
} from "../lib/auth/permissions.ts";
import { maskEmail, maskPhone } from "../lib/format/mask.ts";
import { findDuplicate } from "../lib/people/dedupe.ts";
import { bulkPeopleSchema } from "../lib/validation/people-query.ts";

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
    companyNorms: ["acme"],
  },
  {
    id: "b",
    fullName: "Tan Wei Ming",
    emailNorm: null,
    phoneE164: null,
    companyNorms: [],
  },
];

test("dedupe: same email or phone is a hard match", () => {
  const byEmail = findDuplicate(
    {
      fullName: "Someone",
      emailNorm: "wm@example.com",
      phoneE164: null,
      companyNorm: null,
    },
    existing,
  );
  assert.equal(byEmail.kind, "hard");
  const byPhone = findDuplicate(
    {
      fullName: "Someone",
      emailNorm: null,
      phoneE164: "+60123456789",
      companyNorm: null,
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
      companyNorm: "acme",
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
      companyNorm: null,
    },
    existing,
  );
  assert.equal(r.kind, "none");
});

// Spec §12.2 v1.2: normalised name AND (company | email username | last 7 digits).
const person = (over: Partial<Parameters<typeof findDuplicate>[0]>) => ({
  id: "x",
  fullName: "Tan Mei Ling",
  emailNorm: "tan.ml@gmail.com",
  phoneE164: "+60123456789",
  companyNorms: [],
  ...over,
});

test("dedupe: spelling variants of a name normalise equal", () => {
  const r = findDuplicate(
    {
      fullName: "TAN MEI-LING",
      emailNorm: "tan.ml@acme.com",
      phoneE164: null,
      companyNorm: null,
    },
    [person({})],
  );
  assert.equal(r.kind === "soft" && r.on, "email");
  const r2 = findDuplicate(
    {
      fullName: "Tan Meiling",
      emailNorm: "tan.ml@acme.com",
      phoneE164: null,
      companyNorm: null,
    },
    [person({})],
  );
  assert.equal(r2.kind, "soft");
});

test("dedupe: same name + last 7 phone digits is a soft match", () => {
  const r = findDuplicate(
    {
      fullName: "Tan Mei Ling",
      emailNorm: null,
      phoneE164: "+60193456789",
      companyNorm: null,
    },
    [person({})],
  );
  assert.equal(r.kind === "soft" && r.on, "phone");
});

test("dedupe: signals without a matching name never flag", () => {
  const r = findDuplicate(
    {
      fullName: "Lim Wei Jie",
      emailNorm: "tan.ml@acme.com",
      phoneE164: "+60193456789",
      companyNorm: null,
    },
    [person({})],
  );
  assert.equal(r.kind, "none");
});

test("dedupe: an empty name never soft-matches", () => {
  const r = findDuplicate(
    {
      fullName: "",
      emailNorm: "tan.ml@acme.com",
      phoneE164: null,
      companyNorm: null,
    },
    [person({ fullName: "" })],
  );
  assert.equal(r.kind, "none");
});

test("part_time: no standalone Add person (§6 v1.2)", () => {
  assert.equal(canAddPersonStandalone({ id: "p", role: "part_time" }), false);
  assert.equal(canAddPersonStandalone({ id: "s", role: "sales" }), true);
  assert.equal(canAddPersonStandalone({ id: "m", role: "marketing" }), false);
});

test("bulk body matches §7.1 shape", () => {
  const ok = (b: unknown) => bulkPeopleSchema.safeParse(b).success;
  assert.equal(ok({ personIds: ["a"], action: "add_tag", tagId: "t" }), true);
  assert.equal(
    ok({ personIds: ["a"], action: "assign_owner", ownerId: null }),
    true,
  );
  assert.equal(ok({ personIds: ["a"], action: "add_tag" }), false);
  assert.equal(
    ok({ personIds: Array(501).fill("a"), action: "add_tag", tagId: "t" }),
    false,
  );
});

test("dedupe: a null company never matches; same name alone is not a match", () => {
  const same = { fullName: "Tan Wei Ming", emailNorm: null, phoneE164: null };
  // "N/A" and friends normalise to null in the database, so nothing matches.
  assert.equal(
    findDuplicate({ ...same, companyNorm: null }, existing).kind,
    "none",
  );
  assert.equal(
    findDuplicate({ ...same, companyNorm: "other" }, existing).kind,
    "none",
  );
});
