// Spec §7 GET /api/deals query and POST /api/deals/:id/stage body (§9.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealListQuerySchema,
  dealStageBodySchema,
  dealUpdateSchema,
  readDealParams,
} from "../lib/validation/deal.ts";

const parse = (qs: string) =>
  dealListQuerySchema.safeParse(readDealParams(new URLSearchParams(qs)));

const ID = "00000000-0000-4000-8000-000000000001";

test("list: filter[pipeline] is required and must be a pipeline", () => {
  assert.equal(parse("").success, false);
  assert.equal(parse("filter[pipeline]=retail").success, false);
});

test("list: malformed owner/course id, bad date, unknown funding fail", () => {
  const base = "filter[pipeline]=individual&";
  assert.equal(parse(base + "filter[owner]=abc").success, false);
  assert.equal(parse(base + "filter[course]=123").success, false);
  assert.equal(parse(base + "filter[createdFrom]=2026-02-30").success, false);
  assert.equal(parse(base + "filter[createdTo]=yesterday").success, false);
  assert.equal(parse(base + "filter[funding]=grant").success, false);
});

test("list: a stage from the other pipeline fails", () => {
  assert.equal(
    parse("filter[pipeline]=individual&filter[stage]=discovery").success,
    false,
  );
});

test("list: valid input passes with defaults", () => {
  const r = parse(
    `filter[pipeline]=corporate&filter[stage]=funding&filter[owner]=${ID}` +
      `&filter[course]=${ID}&filter[funding]=hrdc&filter[createdFrom]=2026-09-01` +
      `&filter[createdTo]=2026-09-30&filter[mine]=true&limit=50`,
  );
  assert.ok(r.success);
  assert.equal(r.data.mine, true);
  assert.equal(r.data.limit, 50);
  assert.equal(r.data.page, 1);
  const d = parse("filter[pipeline]=individual");
  assert.ok(d.success && d.data.limit === 25 && d.data.mine === undefined);
});

test("stage body: toStage required; lostReasonId optional", () => {
  assert.equal(dealStageBodySchema.safeParse({}).success, false);
  assert.equal(dealStageBodySchema.safeParse({ toStage: "" }).success, false);
  assert.ok(dealStageBodySchema.safeParse({ toStage: "won" }).success);
  assert.ok(
    dealStageBodySchema.safeParse({ toStage: "lost", lostReasonId: ID })
      .success,
  );
});

// PATCH /api/deals/:id body — spec §9.6. Nine editable fields plus the
// lost-reason correction; everything else is a 400.
const patch = (body: unknown) => dealUpdateSchema.safeParse(body);

test("deal update: stage is never writable here", () => {
  assert.equal(patch({ stage: "won" }).success, false);
  assert.equal(patch({ amountMyr: "100", stage: "won" }).success, false);
});

test("deal update: unknown keys and an empty body are refused", () => {
  assert.equal(patch({ pipeline: "corporate" }).success, false);
  assert.equal(patch({ personId: ID }).success, false);
  assert.equal(patch({ classId: ID }).success, false);
  assert.equal(patch({ wonAt: "2026-09-30" }).success, false);
  assert.equal(patch({}).success, false);
});

test("deal update: headcount is a positive whole number", () => {
  assert.equal(patch({ headcount: 0 }).success, false);
  assert.equal(patch({ headcount: 1.5 }).success, false);
  assert.equal(patch({ headcount: -2 }).success, false);
  assert.equal(patch({ headcount: 12 }).success, true);
  assert.equal(patch({ headcount: null }).success, true);
});

test("deal update: amount is a string with at most two decimals", () => {
  assert.equal(patch({ amountMyr: "-50" }).success, false);
  assert.equal(patch({ amountMyr: "4500.123" }).success, false);
  assert.equal(patch({ amountMyr: "4,500" }).success, false);
  assert.equal(patch({ amountMyr: 4500 }).success, false);
  assert.equal(patch({ amountMyr: "4500" }).success, true);
  assert.equal(patch({ amountMyr: "4500.00" }).success, true);
  assert.equal(patch({ amountMyr: null }).success, true);
});

test("deal update: dates are plain YYYY-MM-DD and funding type is an enum", () => {
  assert.equal(patch({ hrdcDeadlineDate: "30/11/2026" }).success, false);
  assert.equal(
    patch({ hrdcDeadlineDate: "2026-11-30T00:00:00Z" }).success,
    false,
  );
  assert.equal(patch({ hrdcDeadlineDate: "2026-11-30" }).success, true);
  assert.equal(patch({ hrdcApprovalDate: null }).success, true);
  assert.equal(patch({ fundingType: "grant" }).success, false);
  assert.equal(patch({ fundingType: "hrdc" }).success, true);
});

test("deal update: nullable ids accept null and reject junk", () => {
  assert.equal(patch({ companyId: null }).success, true);
  assert.equal(patch({ companyId: "not-a-uuid" }).success, false);
  assert.equal(patch({ ownerId: ID }).success, true);
  // Refusing to clear it is the service's job (422), not the schema's.
  assert.equal(patch({ lostReasonId: null }).success, true);
});

test("filter[incomplete] parses true/false and rejects junk", () => {
  const base = "filter[pipeline]=corporate";
  const on = parse(`${base}&filter[incomplete]=true`);
  assert.equal(on.success && on.data.incomplete, true);
  const off = parse(`${base}&filter[incomplete]=false`);
  assert.equal(off.success && off.data.incomplete, false);
  assert.equal(parse(`${base}&filter[incomplete]=yes`).success, false);
  // Absent stays undefined, so the filter is not applied.
  const none = parse(base);
  assert.equal(none.success && none.data.incomplete, undefined);
});
