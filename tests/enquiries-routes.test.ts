// Spec §9.13 / §7 / §6: what the two enquiry routes accept and who they
// answer. No database and no session — a route here is `getCurrentUser` plus
// the §6 gate, the schema and the service, and the gate, the schemas and the
// row mapper are what this file checks. The audited 403 and every write are
// checked against the database in `enquiries-db`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readIfMatch } from "../lib/api/errors.ts";
import { ROLES, permissionFor, type Role } from "../lib/auth/permissions.ts";
import { toEnquiryRow } from "../lib/enquiries/list.ts";
import { enquiryUpdateSchema } from "../lib/validation/enquiry.ts";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "../lib/validation/enquiry-query.ts";

const USER = "00000000-0000-4000-8000-000000000001";

const query = (search: string) =>
  enquiryListQuerySchema.safeParse(
    readEnquiryParams(new URLSearchParams(search)),
  );

// --- GET /api/enquiries query -------------------------------------------

test("no query is the §9.13 default: open, page 1 of 25", () => {
  const parsed = query("");
  assert.ok(parsed.success);
  assert.equal(parsed.data.status, "open");
  assert.equal(parsed.data.sort, undefined);
  assert.equal(parsed.data.page, 1);
  assert.equal(parsed.data.limit, 25);
});

test("an unknown sort is refused, not ignored", () => {
  assert.equal(query("sort=person_id").success, false);
  for (const sort of [
    "age",
    "-age",
    "firstMessage",
    "-firstMessage",
    "status",
    "-status",
  ])
    assert.ok(query(`sort=${sort}`).success, sort);
});

test("a category outside §5 is refused", () => {
  assert.equal(query("filter[category]=refund").success, false);
  assert.ok(query("filter[category]=hrdc").success);
});

test("over 100 rows is refused rather than cut down (§14)", () => {
  assert.equal(query("limit=500").success, false);
  assert.ok(query("limit=100").success);
});

test("status takes the five §5 values and all", () => {
  for (const s of [
    "open",
    "ai_resolved",
    "human_resolved",
    "converted",
    "closed",
    "all",
  ])
    assert.ok(query(`filter[status]=${s}`).success, s);
  assert.equal(query("filter[status]=pending").success, false);
});

test("assignee takes a user id or unassigned, and nothing else", () => {
  assert.equal(query(`filter[assignee]=${USER}`).success, true);
  const un = query("filter[assignee]=unassigned");
  assert.ok(un.success);
  assert.equal(un.data.assignee, "unassigned");
  assert.equal(query("filter[assignee]=bob").success, false);
});

test("mine and channel read from the §7 filter[...] keys", () => {
  const parsed = query("filter[mine]=true&filter[channel]=whatsapp");
  assert.ok(parsed.success);
  assert.equal(parsed.data.mine, true);
  assert.equal(parsed.data.channel, "whatsapp");
  assert.equal(query("filter[channel]=fax").success, false);
});

// --- Row shape (2.4) ----------------------------------------------------

const rawRow = {
  id: USER,
  version: "3",
  person_id: USER,
  channel: "whatsapp",
  category: null,
  status: "open",
  assigned_user_id: null,
  assignee_name: null,
  first_message_at: null,
  first_response_at: null,
  deal_id: null,
  full_name: null,
  phone: "+60123456789",
  email: "someone@example.com",
  waited_minutes: "12.5",
  response_minutes: null,
};

test("a row carries no phone or email, and its version is a number", () => {
  const row = toEnquiryRow(rawRow as never, 60);
  const body = JSON.parse(JSON.stringify(row));
  assert.equal(body.version, 3);
  for (const key of Object.keys(body))
    assert.doesNotMatch(key, /phone|email/i, key);
  // §11.2: no name, so the phone stands in as the name — and only there.
  assert.equal(body.personName, "+60123456789");
});

test("unset values serialise as null, never 0 or an empty string", () => {
  const body = JSON.parse(JSON.stringify(toEnquiryRow(rawRow as never, 60)));
  for (const key of [
    "category",
    "assignedUserId",
    "assigneeName",
    "firstMessageAt",
    "firstResponseAt",
    "dealId",
  ])
    assert.equal(body[key], null, key);
  assert.equal(body.waitedMinutes, 12);
  assert.equal(body.pastSla, false);
});

// --- PATCH /api/enquiries/:id body (3.1) --------------------------------

const patch = (body: unknown) => enquiryUpdateSchema.safeParse(body);

test("assign takes a user id, me, or null to clear", () => {
  assert.ok(patch({ action: "assign", assignee: USER }).success);
  assert.ok(patch({ action: "assign", assignee: "me" }).success);
  assert.ok(patch({ action: "assign", assignee: null }).success);
  assert.equal(patch({ action: "assign", assignee: "bob" }).success, false);
});

test("category takes the ten §5 values only", () => {
  assert.ok(patch({ action: "category", category: "hrdc" }).success);
  assert.equal(
    patch({ action: "category", category: "refund" }).success,
    false,
  );
});

test("close refuses ai_resolved and converted outright", () => {
  for (const status of ["ai_resolved", "converted", "open"])
    assert.equal(
      patch({ action: "close", status, note: "Called back" }).success,
      false,
      status,
    );
  assert.ok(
    patch({
      action: "close",
      status: "human_resolved",
      note: "Sent the brochure",
    }).success,
  );
  assert.ok(
    patch({ action: "close", status: "closed", note: "Wrong number" }).success,
  );
});

test("close needs a note that is more than whitespace", () => {
  for (const note of ["", "   ", "\n\t"])
    assert.equal(
      patch({ action: "close", status: "closed", note }).success,
      false,
      JSON.stringify(note),
    );
  assert.equal(patch({ action: "close", status: "closed" }).success, false);
});

test("an unknown action is refused", () => {
  assert.equal(patch({ action: "convert" }).success, false);
  assert.equal(patch(null).success, false);
});

// --- If-Match (3.5) -----------------------------------------------------

const withIfMatch = (value?: string) =>
  new Request("http://localhost/api/enquiries/x", {
    method: "PATCH",
    headers: value === undefined ? {} : { "If-Match": value },
  });

test("no If-Match, or a non-positive one, is a 428 (§7 v1.7)", () => {
  for (const value of [undefined, "", "0", "-1", "abc", "1.5"])
    assert.equal(readIfMatch(withIfMatch(value)), null, String(value));
  assert.equal(readIfMatch(withIfMatch("4")), 4);
});

// --- §6 enquiry row: F R - R E R A ---------------------------------------

test("six roles read the queue, marketing has none (§6)", () => {
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "enquiry", "read").allowed,
      role !== "marketing",
      role,
    );
});

test("super_admin, support and part_time write; the other four are 403 (§6)", () => {
  const writers: Role[] = ["super_admin", "support", "part_time"];
  for (const role of ROLES)
    assert.equal(
      permissionFor({ id: "u", role }, "enquiry", "write").allowed,
      writers.includes(role),
      role,
    );
});

test("only part_time is limited to enquiries assigned to them (§6 A)", () => {
  for (const role of ROLES) {
    assert.equal(
      permissionFor({ id: "u", role }, "enquiry", "read").assignedOnly,
      role === "part_time",
      role,
    );
    assert.equal(
      permissionFor({ id: "u", role }, "enquiry", "write").assignedOnly,
      role === "part_time",
      role,
    );
  }
});
