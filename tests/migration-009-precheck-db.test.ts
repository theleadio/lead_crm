// Migration 009's pre-check for legacy match_payment tasks (they cannot have a
// payment_id yet, and the new CHECK would refuse them with a bare constraint
// error). The test runs the migration's own text: the block between the
// "precheck:match_payment" markers, in a rolled-back transaction. (The whole
// file cannot run here: it has its own BEGIN/COMMIT.)
import { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeDb, db } from "../lib/sql.ts";
import { it } from "./seed.ts";

after(closeDb);

const sqlText = readFileSync(
  new URL("../lib/db/migrations/009_pre_freeze_schema.sql", import.meta.url),
  "utf8",
);
const block =
  /-- precheck:match_payment begin[^\n]*\n([\s\S]*?)-- precheck:match_payment end/.exec(
    sqlText,
  )?.[1];

it("migration 009 pre-check: passes with no legacy match_payment task; stops with the count and a hint when there is one", async () => {
  assert.ok(block?.includes("DO $$"), "pre-check block not found in 009");
  const sql = block ?? "";
  await db().unsafe(sql); // nothing wrong: no error

  // Re-create the pre-009 situation: no CHECK, a task with no payment_id.
  await db()`ALTER TABLE task DROP CONSTRAINT task_match_payment_needs_payment`;
  await db()`INSERT INTO task (type, title) VALUES ('match_payment', 'legacy 1')`;
  await db()`
    INSERT INTO task (type, title, done_at)
    VALUES ('match_payment', 'legacy 2 (closed)', now())`;
  await assert.rejects(
    db().unsafe(sql),
    (e: Error & { hint?: string }) =>
      /migration 009: 2 match_payment task\(s\) have no payment_id/.test(
        e.message,
      ) && /payment_id/.test(e.hint ?? ""),
  );
});
