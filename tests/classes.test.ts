// Spec §9.8 Classes list: the query the screen may ask for, and the status
// colours it renders. No database — the list query and the display map are
// both pure.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASS_STATUSES,
  classStatusBadge,
  seatBarColor,
} from "../lib/classes/types.ts";
import {
  classListQuerySchema,
  readClassParams,
} from "../lib/validation/class-query.ts";

const parse = (input: Record<string, string>) =>
  classListQuerySchema.safeParse(readClassParams(new URLSearchParams(input)));

test("no query means upcoming classes, page 1 of 25", () => {
  const r = parse({});
  assert.ok(r.success);
  assert.deepEqual(r.data, {
    when: "upcoming",
    page: 1,
    limit: 25,
    courseId: undefined,
    status: undefined,
    language: undefined,
    sort: undefined,
  });
});

test("the past view is asked for by name", () => {
  const r = parse({ when: "past" });
  assert.ok(r.success);
  assert.equal(r.data.when, "past");
});

test("the three filters parse from filter[...]", () => {
  const courseId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const r = parse({
    "filter[courseId]": courseId,
    "filter[status]": "cancelled",
    "filter[language]": "zh",
    sort: "-course",
  });
  assert.ok(r.success);
  assert.equal(r.data.courseId, courseId);
  assert.equal(r.data.status, "cancelled");
  assert.equal(r.data.language, "zh");
  assert.equal(r.data.sort, "-course");
});

test("anything outside the allow-lists is rejected", () => {
  const bad: Record<string, string>[] = [
    { when: "soon" },
    { "filter[status]": "finished" },
    { "filter[language]": "ms" },
    { "filter[courseId]": "AIA-2610-EN" },
    { sort: "online_url" },
    { sort: "price" },
    { limit: "500" },
    { limit: "0" },
    { page: "0" },
  ];
  for (const input of bad)
    assert.equal(parse(input).success, false, JSON.stringify(input));
});

test("every §5 class_status has a §9.8 label and colour", () => {
  for (const status of CLASS_STATUSES) {
    const badge = classStatusBadge(status);
    assert.ok(badge.label.length > 0, status);
    assert.ok(badge.variant.length > 0, status);
    assert.ok(seatBarColor(status).startsWith("bg-"), status);
  }
  assert.deepEqual(classStatusBadge("open"), {
    label: "Open",
    variant: "success",
  });
  assert.deepEqual(classStatusBadge("few_seats"), {
    label: "Few seats",
    variant: "warning",
  });
  assert.deepEqual(classStatusBadge("full"), {
    label: "Full",
    variant: "default",
  });
  assert.deepEqual(classStatusBadge("cancelled"), {
    label: "Cancelled",
    variant: "destructive",
  });
});

test("a status the screen doesn't know shows as plain text", () => {
  assert.deepEqual(classStatusBadge("postponed"), {
    label: "postponed",
    variant: "secondary",
  });
});
