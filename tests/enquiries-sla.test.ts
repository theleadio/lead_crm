// Spec §9.13 past-SLA rule: the setting read and the one predicate. No
// database — `slaMinutes` takes the query function, so a stand-in returns the
// row the setting table would.
import { test } from "node:test";
import assert from "node:assert/strict";
import type postgres from "postgres";
import { isPastSla, slaMinutes } from "../lib/enquiries/sla.ts";

const settingRows = (rows: { minutes: string | null }[]) =>
  (async () => rows) as unknown as postgres.Sql;

test("the SLA is read from the setting row", async () => {
  assert.equal(await slaMinutes(settingRows([{ minutes: "60" }])), 60);
  assert.equal(await slaMinutes(settingRows([{ minutes: "120" }])), 120);
});

test("no setting row means no limit, not a number made up in code", async () => {
  assert.equal(await slaMinutes(settingRows([])), null);
});

test("a setting that is not a positive whole number means no limit", async () => {
  for (const minutes of ["sixty", "", "1.5", "-5", "0", null])
    assert.equal(
      await slaMinutes(settingRows([{ minutes }])),
      null,
      String(minutes),
    );
});

const open = (waitedMinutes: number, responseMinutes: number | null = null) =>
  ({ status: "open", waitedMinutes, responseMinutes }) as const;

test("an open enquiry at exactly the limit is not late", () => {
  assert.equal(isPastSla(open(60), 60), false);
});

test("an open enquiry one minute over the limit is late", () => {
  assert.equal(isPastSla(open(61), 60), true);
});

test("a reply inside the limit on a week-old enquiry is not late", () => {
  assert.equal(isPastSla(open(7 * 24 * 60, 10), 60), false);
});

test("a reply outside the limit is late although it was answered", () => {
  assert.equal(isPastSla(open(7 * 24 * 60, 180), 60), true);
});

test("a closed, resolved or converted enquiry is never late", () => {
  for (const status of [
    "closed",
    "converted",
    "human_resolved",
    "ai_resolved",
  ] as const)
    assert.equal(
      isPastSla({ status, waitedMinutes: 10_000, responseMinutes: null }, 60),
      false,
      status,
    );
});

test("raising the setting unmarks rows under the new limit", () => {
  assert.equal(isPastSla(open(90), 60), true);
  assert.equal(isPastSla(open(90), 120), false);
});

test("with no setting nothing is marked", () => {
  assert.equal(isPastSla(open(10_000), null), false);
});
