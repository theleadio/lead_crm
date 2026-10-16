-- =============================================================================
-- LEAD CRM — migration 011
-- task.source_key: the dedupe key of a task a worker creates from an outbox
-- event (spec §11.1, §12.11). Shawn-only plumbing for lib/events/handlers.ts.
--
-- The drain can run the same event more than once (a dead letter revived with
-- retryDeadEvents(), a re-raised row), so a handler must not open a second
-- task for the same event. 004 and 009 guard "one open task per deal / per
-- payment" with a partial unique index; an event task has no such natural
-- owner, so the handler writes a key of its own ('<event id>:<what>:<enrolment
-- id>') and inserts with ON CONFLICT DO NOTHING. Unlike the open-task guards
-- the key stays unique after the task is done: a closed task is not recreated.
--
-- NULL for every task a person creates. No backfill, nothing rewritten.
-- Re-running is harmless (IF NOT EXISTS). Owner: Shawn. 9 Oct 2026.
-- =============================================================================

BEGIN;

ALTER TABLE task ADD COLUMN IF NOT EXISTS source_key text;
CREATE UNIQUE INDEX IF NOT EXISTS task_source_key_uq ON task (source_key)
  WHERE source_key IS NOT NULL;

COMMIT;
