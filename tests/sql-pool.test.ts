import assert from "node:assert/strict";
import { test } from "node:test";
import { poolSize } from "../lib/sql.ts";

test("a serverless function on the session pooler keeps one connection", () => {
  assert.equal(poolSize("postgres://u@h.example:5432/db", true), 1);
});

test("a serverless function on the transaction pooler may overlap queries", () => {
  assert.equal(poolSize("postgres://u@h.example:6543/db", true), 4);
});

test("a long-running server keeps its pool of five", () => {
  assert.equal(poolSize("postgres://u@h.example:5432/db", false), 5);
});
