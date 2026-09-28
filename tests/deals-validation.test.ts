// Spec §7 GET /api/deals query and POST /api/deals/:id/stage body (§9.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealListQuerySchema,
  dealStageBodySchema,
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
