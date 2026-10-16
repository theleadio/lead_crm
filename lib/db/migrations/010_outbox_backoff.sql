-- =============================================================================
-- LEAD CRM — migration 010
-- Open item O34, finding S-12 of the pre-freeze schema review (docs/superpowers/
-- notes/2026-10-08-pre-freeze-schema-review.md). Shawn-only plumbing: the drain
-- (lib/events/drain.ts) changes with it; raiseEvent and Zixuan's code do not.
--
--  1. event_outbox.next_attempt_at: a failed row is not claimed again until
--     this time. Without it the runner re-claimed a failing row at once and
--     burned all 5 attempts in milliseconds, so a 30 s outage meant permanent
--     dead letters. The drain sets it to now() + a backoff on each failure.
--  2. event_outbox.dead_at: a row that used up its attempts. "Dead" was only
--     recognisable by a TypeScript constant (attempts >= MAX_ATTEMPTS); the
--     health panel and BI should not hard-code 5. A dead row stays pending
--     (processed_at NULL) and visible; the CHECK event_outbox_dead_is_pending
--     says a row cannot be both dead and processed. Retry clears dead_at.
--  3. event_outbox.seq: bigint identity. created_at is the transaction's start
--     time, so two events raised in one transaction tie; seq is the tiebreak
--     (claim order is next_attempt_at, seq).
--  4. Index event_outbox_pending_idx (created_at, dead rows included) becomes
--     event_outbox_due_idx (next_attempt_at, seq) over live pending rows only.
--  5. integration_event (webhook staging, no code uses it yet) gets the same
--     retry columns, attempts and next_attempt_at, and a due index.
--
-- Backfills:
--   * next_attempt_at: existing rows get the migration time (the column
--     default), so every pending row is due at once. Their relative order
--     comes from seq.
--   * seq: existing rows are numbered in (created_at, id) order. Adding an
--     identity column to a populated table fills it in unspecified order, so
--     the column is added as plain bigint, numbered with row_number(), made
--     NOT NULL, and only then turned into an identity whose sequence starts
--     after the highest number. If the table is empty the sequence starts at 1.
--   * dead_at: pending rows (processed_at IS NULL) with attempts >= 5 were dead
--     letters under the old rule; they get dead_at = now(). Nothing is deleted
--     or reset. Retry them with retryDeadEvents() once the cause is fixed.
--     (The UPDATE bumps updated_at through the 001 trigger.)
--   * integration_event: no row is touched; attempts is 0 and next_attempt_at
--     is the migration time.
--
-- Applied once, in order, like 001–009. Re-running it is harmless: columns and
-- indexes use IF NOT EXISTS, the seq step is skipped once the column exists
-- (so seq is never renumbered), the constraint is dropped and re-added, and the
-- dead_at backfill only touches rows that are still alive. Owner: Shawn.
-- 9 Oct 2026.
-- =============================================================================

BEGIN;
SET LOCAL client_min_messages = warning;   -- quiet the "does not exist, skipping" notices

-- -----------------------------------------------------------------------------
-- 1. event_outbox: next_attempt_at, dead_at
-- -----------------------------------------------------------------------------
ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dead_at         timestamptz;

-- -----------------------------------------------------------------------------
-- 2. event_outbox.seq: number existing rows in (created_at, id) order, then
--    attach the identity. Skipped when the column already exists.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'event_outbox'
               AND column_name = 'seq') THEN
    RETURN;
  END IF;

  ALTER TABLE event_outbox ADD COLUMN seq bigint;
  UPDATE event_outbox o SET seq = n.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM event_outbox) n
  WHERE o.id = n.id;
  ALTER TABLE event_outbox ALTER COLUMN seq SET NOT NULL;
  ALTER TABLE event_outbox ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;
  PERFORM setval(pg_get_serial_sequence('event_outbox', 'seq'),
                 coalesce(max(seq), 1), max(seq) IS NOT NULL)
  FROM event_outbox;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Dead-letter backfill, then the CHECK
-- -----------------------------------------------------------------------------
UPDATE event_outbox SET dead_at = now()
WHERE processed_at IS NULL AND dead_at IS NULL AND attempts >= 5;

ALTER TABLE event_outbox DROP CONSTRAINT IF EXISTS event_outbox_dead_is_pending;
ALTER TABLE event_outbox ADD CONSTRAINT event_outbox_dead_is_pending
  CHECK (dead_at IS NULL OR processed_at IS NULL);

-- -----------------------------------------------------------------------------
-- 4. Index: due, live, pending rows in claim order
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS event_outbox_pending_idx;
CREATE INDEX IF NOT EXISTS event_outbox_due_idx ON event_outbox (next_attempt_at, seq)
  WHERE processed_at IS NULL AND dead_at IS NULL;

-- -----------------------------------------------------------------------------
-- 5. integration_event: the same retry columns
-- -----------------------------------------------------------------------------
ALTER TABLE integration_event
  ADD COLUMN IF NOT EXISTS attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS integration_event_due_idx ON integration_event (next_attempt_at)
  WHERE status IN ('received', 'failed');

COMMIT;
