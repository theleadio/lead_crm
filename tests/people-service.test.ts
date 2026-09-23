import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bulkUpdatePeople,
  createPerson,
  exportPeople,
  InvalidBulkChange,
  listPeople,
} from "../lib/people/service.ts";
import { MOCK_AUDIT_LOG } from "../lib/audit.ts";
import { toCsv } from "../lib/format/csv.ts";

const admin = { id: "admin", role: "super_admin" as const };
const marketing = { id: "mkt", role: "marketing" as const };
const partTimer = { id: "u-1", role: "part_time" as const };

const baseInput = {
  fullName: "New Person",
  preferredLanguage: "en" as const,
};

test("marketing gets masked phone and email, never the real values", async () => {
  const { data } = await listPeople({ page: 1, limit: 100 }, marketing);
  for (const p of data) {
    assert.equal(p.phoneE164, null);
    if (p.email) assert.match(p.email, /^.••••@/);
    if (p.phone && p.phone !== "••••") assert.match(p.phone, /-•••• \d{4}$/);
  }
});

test("part_time only sees people they own", async () => {
  const { data, page } = await listPeople({ page: 1, limit: 100 }, partTimer);
  assert.ok(page.total > 0);
  assert.ok(data.every((p) => p.owner?.id === "u-1"));
});

test("filters: owner, tag, open deal, created between", async () => {
  const q = (f: object) => listPeople({ page: 1, limit: 100, ...f }, admin);

  const unassigned = await q({ owner: "unassigned" });
  assert.ok(
    unassigned.data.length > 0 && unassigned.data.every((p) => !p.owner),
  );

  const vip = await q({ tags: ["vip"] });
  assert.ok(
    vip.data.length > 0 && vip.data.every((p) => p.tags.includes("vip")),
  );

  const all = await q({});
  const withDeal = await q({ hasOpenDeal: true });
  const withoutDeal = await q({ hasOpenDeal: false });
  assert.equal(withDeal.page.total + withoutDeal.page.total, all.page.total);

  // Mock people are created one per day back from 23 Sep 2026 (MYT).
  const week = await q({ createdFrom: "2026-09-17", createdTo: "2026-09-23" });
  assert.equal(week.page.total, 7);
});

test("createPerson: hard match on phone returns the existing person", async () => {
  const { data } = await listPeople({ page: 1, limit: 1 }, admin);
  const existing = data[0];
  const result = await createPerson(
    { ...baseInput, phone: existing.phone ?? undefined },
    admin,
  );
  assert.equal(result.kind, "duplicate");
  assert.equal(result.kind === "duplicate" && result.existing.id, existing.id);
});

test("createPerson: creates, audit-logs, and flags an unnormalisable phone", async () => {
  const before = MOCK_AUDIT_LOG.length;
  const result = await createPerson(
    { ...baseInput, fullName: "Odd Phone", phone: "12345" },
    admin,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;
  assert.equal(result.person.phone, "12345");
  assert.equal(result.person.phoneE164, null);
  assert.equal(result.person.needsReview, true);
  assert.equal(result.person.stage, "lead");
  assert.equal(MOCK_AUDIT_LOG.length, before + 1);
  assert.equal(MOCK_AUDIT_LOG.at(-1)?.action, "create");
});

test("bulk: assigns owner and adds tag, rejects unknown values", async () => {
  const { data } = await listPeople({ page: 1, limit: 2 }, admin);
  const ids = data.map((p) => p.id);

  const owned = await bulkUpdatePeople(
    ids,
    { kind: "assignOwner", ownerId: "u-2" },
    admin,
  );
  assert.equal(owned.updated, 2);
  await bulkUpdatePeople(ids, { kind: "addTag", tag: "vip" }, admin);
  const after = await listPeople({ page: 1, limit: 2 }, admin);
  assert.ok(
    after.data.every((p) => p.owner?.id === "u-2" && p.tags.includes("vip")),
  );

  await assert.rejects(
    bulkUpdatePeople(ids, { kind: "addTag", tag: "not-a-tag" }, admin),
    InvalidBulkChange,
  );
});

test("bulk: part_time can't touch people they don't own", async () => {
  const { data } = await listPeople(
    { page: 1, limit: 100, owner: "u-2" },
    admin,
  );
  const result = await bulkUpdatePeople(
    data.map((p) => p.id),
    { kind: "addTag", tag: "vip" },
    partTimer,
  );
  assert.equal(result.updated, 0);
});

test("export returns every matching row and is audit-logged", async () => {
  const all = await listPeople({ page: 1, limit: 25 }, admin);
  const rows = await exportPeople({}, admin);
  assert.equal(rows.length, all.page.total);
  assert.equal(MOCK_AUDIT_LOG.at(-1)?.action, "export");
});

test("CSV quotes commas and neutralises formulas but keeps phone numbers", () => {
  const csv = toCsv(["a", "b", "c"], [["=SUM(A1)", "+60 12-345 6789", "x, y"]]);
  assert.equal(csv, 'a,b,c\r\n\'=SUM(A1),+60 12-345 6789,"x, y"');
});
