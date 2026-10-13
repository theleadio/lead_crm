// Integration tests for POST /api/deals (spec §7 "Create", the New deal
// control on §9.5 and §9.2): what the form may set, what only a stage move
// may set (§12.5), and who may create at all (§6 deal row).
// Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { createDeal } from "../lib/deals/detail-service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { dealCreateSchema } from "../lib/validation/deal.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };
const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const operations: Viewer = { id: SEED_USERS.admin, role: "operations" };

async function anyPerson(): Promise<string> {
  const [p] = await db()`
    SELECT id FROM person WHERE deleted_at IS NULL AND merged_into_id IS NULL
    LIMIT 1`;
  return p.id;
}

async function anyCourse(): Promise<string> {
  const [c] = await db()`SELECT id FROM course WHERE is_active LIMIT 1`;
  return c.id;
}

it("a new deal opens in `new`, owned by whoever created it", async () => {
  const personId = await anyPerson();
  const result = await createDeal({ pipeline: "individual", personId }, sales);
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;

  assert.equal(result.deal.stage, "new");
  assert.equal(result.deal.pipeline, "individual");
  assert.equal(result.deal.owner?.id, sales.id);
  // §12.5: `new` is where it starts, not a move — nothing to show yet.
  assert.equal(result.deal.stageHistory.length, 0);
});

it("the fields the form may set are saved", async () => {
  const personId = await anyPerson();
  const courseId = await anyCourse();
  const result = await createDeal(
    {
      pipeline: "corporate",
      personId,
      courseId,
      headcount: 12,
      amountMyr: "48000.00",
      fundingType: "hrdc",
      hrdcGrantRef: "HRDC-2026-001",
      ownerId: SEED_USERS.weiPing,
    },
    admin,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;

  assert.equal(result.deal.course?.id, courseId);
  assert.equal(result.deal.headcount, 12);
  assert.equal(result.deal.amountMyr, "48000.00");
  assert.equal(result.deal.fundingType, "hrdc");
  assert.equal(result.deal.owner?.id, SEED_USERS.weiPing);
});

it("an unowned deal stays unowned (§9.5 owner filter)", async () => {
  const personId = await anyPerson();
  const result = await createDeal(
    { pipeline: "individual", personId, ownerId: null },
    sales,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;
  assert.equal(result.deal.owner, null);
});

it("a corporate deal may open without company, headcount or funding", async () => {
  // §12.5 gates the way out of discovery, not the opening of the deal.
  const result = await createDeal(
    { pipeline: "corporate", personId: await anyPerson() },
    sales,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;
  assert.equal(result.deal.company, null);
  assert.equal(result.deal.headcount, null);
});

it("a merged-away person gets no deal", async () => {
  const personId = await anyPerson();
  const [survivor] = await db()`
    SELECT id FROM person WHERE id <> ${personId} AND deleted_at IS NULL
      AND merged_into_id IS NULL LIMIT 1`;
  await db()`
    UPDATE person SET merged_into_id = ${survivor.id} WHERE id = ${personId}`;

  const result = await createDeal({ pipeline: "individual", personId }, sales);
  assert.equal(result.kind, "not_found");
});

it("an id that names nothing is a field message, not a foreign-key error", async () => {
  const result = await createDeal(
    {
      pipeline: "individual",
      personId: await anyPerson(),
      courseId: crypto.randomUUID(),
      ownerId: crypto.randomUUID(),
    },
    sales,
  );
  assert.equal(result.kind, "invalid");
  if (result.kind !== "invalid") return;
  assert.ok(result.fields.courseId);
  assert.ok(result.fields.ownerId);

  const [{ n }] = await db()`SELECT count(*)::int AS n FROM deal
                             WHERE created_by = ${sales.id}
                               AND created_at > now() - interval '1 minute'`;
  assert.equal(n, 0);
});

it("the create is audited (§4)", async () => {
  const result = await createDeal(
    { pipeline: "individual", personId: await anyPerson() },
    sales,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;

  const [row] = await db()`
    SELECT action, after FROM audit_log
    WHERE entity = 'deal' AND entity_id = ${result.deal.id}`;
  assert.equal(row.action, "create");
  assert.equal(row.after.stage, "new");
});

it("creating a deal raises no event (§11.1 has no DealCreated)", async () => {
  const result = await createDeal(
    { pipeline: "individual", personId: await anyPerson() },
    sales,
  );
  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;

  const rows = await db()`
    SELECT type FROM event_outbox WHERE aggregate_id = ${result.deal.id}`;
  assert.equal(rows.length, 0);
});

it("only the roles with deal write may create (§6)", async () => {
  const personId = await anyPerson();
  for (const viewer of [marketing, operations]) {
    const result = await createDeal(
      { pipeline: "individual", personId },
      viewer,
    );
    assert.equal(result.kind, "forbidden", viewer.role);
  }
});

test("the create body refuses stage, classId and a lost reason", () => {
  const base = { pipeline: "individual", personId: crypto.randomUUID() };
  assert.equal(dealCreateSchema.safeParse(base).success, true);
  for (const extra of [
    { stage: "won" },
    { classId: crypto.randomUUID() },
    { lostReasonId: crypto.randomUUID() },
  ])
    assert.equal(
      dealCreateSchema.safeParse({ ...base, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
});

test("the create body needs a pipeline and a person", () => {
  assert.equal(
    dealCreateSchema.safeParse({ personId: crypto.randomUUID() }).success,
    false,
  );
  assert.equal(
    dealCreateSchema.safeParse({ pipeline: "individual" }).success,
    false,
  );
  assert.equal(
    dealCreateSchema.safeParse({
      pipeline: "walk_in",
      personId: crypto.randomUUID(),
    }).success,
    false,
  );
});
