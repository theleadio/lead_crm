import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportPersonData,
  getPersonConsent,
  getPersonDetail,
  getPersonTimeline,
  personDataToRows,
} from "../lib/people/detail-service.ts";
import { MOCK_PEOPLE } from "../lib/people/mock-data.ts";
import { MOCK_AUDIT_LOG } from "../lib/audit.ts";
import {
  canAddPersonStandalone,
  type Viewer,
} from "../lib/auth/permissions.ts";
import { bulkPeopleSchema } from "../lib/validation/people-query.ts";

const admin: Viewer = { id: "admin", role: "super_admin" };
const marketing: Viewer = { id: "mkt", role: "marketing" };
const partTimer: Viewer = { id: "u-1", role: "part_time" };
const customer = () => MOCK_PEOPLE.find((p) => p.stage === "customer")!;

test("timeline: newest first, paginated, payments audit-logged", async () => {
  const r = await getPersonTimeline(customer().id, admin, 1, 3);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.result.data.length, 3);
  assert.ok(r.result.page.total > 3);
  const times = r.result.data.map((t) => Date.parse(t.at));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );

  const before = MOCK_AUDIT_LOG.length;
  const all = await getPersonTimeline(customer().id, admin, 1, 50);
  const payments =
    all.kind === "ok"
      ? all.result.data.filter((t) => t.kind === "payment")
      : [];
  assert.ok(payments.length > 0);
  assert.equal(MOCK_AUDIT_LOG.length, before + payments.length);
});

test("timeline: marketing never sees payments or enrolment changes", async () => {
  const r = await getPersonTimeline(customer().id, marketing, 1);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.ok(
    r.result.data.every(
      (t) => t.kind !== "payment" && t.kind !== "enrolment_change",
    ),
  );
});

test("consent: readable by marketing, forbidden for part_time", async () => {
  const p = MOCK_PEOPLE[1];
  const r = await getPersonConsent(p.id, marketing);
  assert.equal(r.kind === "ok" && r.consent.length, 2);
  assert.equal((await getPersonConsent(p.id, partTimer)).kind, "forbidden");
});

test("part_time: sees a person via an assigned enquiry, including that enquiry", async () => {
  const p = MOCK_PEOPLE.find(
    (x) => x.assignedUserIds.includes("u-1") && x.owner?.id !== "u-1",
  )!;
  const r = await getPersonDetail(p.id, partTimer);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.detail.deals, null); // part_time has no deal access (§6)
  assert.ok(r.detail.enquiries);
});

test("part_time: no standalone Add person (§6 v1.2)", () => {
  assert.equal(canAddPersonStandalone(partTimer), false);
  assert.equal(canAddPersonStandalone({ id: "s", role: "sales" }), true);
  assert.equal(canAddPersonStandalone(marketing), false);
});

test("PDPA export: super_admin only, unmasked, audit-logged, CSV rows", async () => {
  const p = customer();
  assert.equal(
    (await exportPersonData(p.id, marketing, "json")).kind,
    "forbidden",
  );

  const r = await exportPersonData(p.id, admin, "csv");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal((r.data.person as { email: string }).email, p.email);
  assert.equal(MOCK_AUDIT_LOG.at(-1)?.action, "export");

  const rows = personDataToRows(r.data);
  assert.ok(
    rows.some(
      ([section, , field]) => section === "person" && field === "email",
    ),
  );
  assert.ok(rows.some(([section]) => section === "payments"));
});

test("bulk body matches §7.1 shape", () => {
  assert.equal(
    bulkPeopleSchema.safeParse({
      personIds: ["a"],
      action: "add_tag",
      tagId: "t-3",
    }).success,
    true,
  );
  assert.equal(
    bulkPeopleSchema.safeParse({
      personIds: ["a"],
      action: "assign_owner",
      ownerId: null,
    }).success,
    true,
  );
  assert.equal(
    bulkPeopleSchema.safeParse({ personIds: ["a"], action: "add_tag" }).success,
    false,
  );
  assert.equal(
    bulkPeopleSchema.safeParse({
      personIds: Array(501).fill("a"),
      action: "add_tag",
      tagId: "t",
    }).success,
    false,
  );
});
