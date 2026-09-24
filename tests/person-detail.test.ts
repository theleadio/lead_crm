import { test } from "node:test";
import assert from "node:assert/strict";
import { getPersonDetail, updatePerson } from "../lib/people/detail-service.ts";
import { MOCK_PEOPLE } from "../lib/people/mock-data.ts";
import { MOCK_AUDIT_LOG } from "../lib/audit.ts";
import type { Viewer } from "../lib/auth/permissions.ts";

const admin: Viewer = { id: "admin", role: "super_admin" };
const marketing: Viewer = { id: "mkt", role: "marketing" };

const customer = () => MOCK_PEOPLE.find((p) => p.stage === "customer")!;
const detailOf = async (id: string, viewer: Viewer = admin) => {
  const r = await getPersonDetail(id, viewer);
  assert.equal(r.kind, "ok");
  return r.kind === "ok" ? r.detail : (null as never);
};

test("unknown id is not_found; part_time can't open someone else's person", async () => {
  assert.equal((await getPersonDetail("nope", admin)).kind, "not_found");
  const notMine = MOCK_PEOPLE.find((p) => p.owner?.id === "u-2")!;
  const r = await getPersonDetail(notMine.id, { id: "u-1", role: "part_time" });
  assert.equal(r.kind, "forbidden");
});

test("admin sees every panel, and viewing payments is audit-logged", async () => {
  const before = MOCK_AUDIT_LOG.length;
  const d = await detailOf(customer().id);
  assert.ok(d.deals && d.enrolments && d.payments && d.enquiries && d.consent);
  assert.ok(d.payments!.length > 0);
  assert.equal(MOCK_AUDIT_LOG.length, before + d.payments!.length);
  assert.equal(MOCK_AUDIT_LOG.at(-1)?.action, "view");
  assert.equal(MOCK_AUDIT_LOG.at(-1)?.entity, "payment");
});

test("marketing: masked contact details, no enrolments/payments/enquiries", async () => {
  const d = await detailOf(customer().id, marketing);
  assert.match(d.person.email!, /^.••••@/);
  assert.match(d.person.phone!, /••••/);
  assert.equal(d.enrolments, null);
  assert.equal(d.payments, null);
  assert.equal(d.enquiries, null);
  assert.ok(d.deals); // marketing may read deals (§6)
});

test("sales only sees payments on deals they own", async () => {
  const p = customer();
  p.owner = { id: "u-1", fullName: "Wei Ping" };
  const own = await detailOf(p.id, { id: "u-1", role: "sales" });
  const other = await detailOf(p.id, { id: "u-2", role: "sales" });
  assert.equal(own.payments!.length, 1);
  assert.equal(other.payments!.length, 0);
});

test("update: saves changed fields, audits only those, leaves last activity alone", async () => {
  const p = MOCK_PEOPLE[4];
  const lastActivity = p.lastActivityAt;
  const r = await updatePerson(
    p.id,
    { jobTitle: "HR Manager" },
    p.updatedAt,
    admin,
  );
  assert.equal(r.kind, "updated");
  assert.equal(p.jobTitle, "HR Manager");
  assert.equal(p.lastActivityAt, lastActivity);
  assert.deepEqual(MOCK_AUDIT_LOG.at(-1)?.after, { jobTitle: "HR Manager" });
});

test("update: stale updated_at is rejected", async () => {
  const p = MOCK_PEOPLE[5];
  const loaded = p.updatedAt;
  await updatePerson(p.id, { jobTitle: "First save" }, loaded, admin);
  const r = await updatePerson(
    p.id,
    { jobTitle: "Second save" },
    loaded,
    admin,
  );
  assert.equal(r.kind, "stale");
  assert.equal(p.jobTitle, "First save");
});

test("update: phone belonging to someone else is a duplicate", async () => {
  const [a, b] = [MOCK_PEOPLE[6], MOCK_PEOPLE[7]];
  const r = await updatePerson(a.id, { phone: b.phone! }, a.updatedAt, admin);
  assert.equal(r.kind === "duplicate" && r.existing.id, b.id);
});

test("update: bad WhatsApp is a field error; bad phone is kept and flagged", async () => {
  const p = MOCK_PEOPLE[8];
  const bad = await updatePerson(p.id, { whatsapp: "123" }, p.updatedAt, admin);
  assert.equal(
    bad.kind === "invalid" && bad.fields.whatsapp !== undefined,
    true,
  );

  const flagged = await updatePerson(
    p.id,
    { phone: "999" },
    p.updatedAt,
    admin,
  );
  assert.equal(flagged.kind, "updated");
  assert.equal(p.phone, "999");
  assert.equal(p.phoneE164, null);
  assert.equal(p.needsReview, true);

  const fixed = await updatePerson(
    p.id,
    { phone: "019-876 5432" },
    p.updatedAt,
    admin,
  );
  assert.equal(fixed.kind, "updated");
  assert.equal(p.phoneE164, "+60198765432");
  assert.equal(p.needsReview, false);
});

test("update: marketing can't edit", async () => {
  const p = MOCK_PEOPLE[9];
  const r = await updatePerson(p.id, { jobTitle: "x" }, p.updatedAt, marketing);
  assert.equal(r.kind, "forbidden");
});
