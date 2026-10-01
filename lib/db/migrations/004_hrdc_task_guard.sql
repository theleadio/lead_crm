-- =============================================================================
-- LEAD CRM — migration 004
-- At most one open hrdc_deadline task per deal (spec 12.6).
-- The app creates the task when a deal enters funding (or when the deadline
-- date is added while in funding). This index makes a double-click, a retry
-- or two users saving at once fail instead of creating a second task.
-- Owner: Shawn. 28 Sep 2026.
-- =============================================================================

BEGIN;

-- An hrdc_deadline task always belongs to a deal.
ALTER TABLE task
  ADD CONSTRAINT task_hrdc_deadline_needs_deal
    CHECK (type <> 'hrdc_deadline' OR deal_id IS NOT NULL);

-- One open (not done) hrdc_deadline task per deal. Done tasks don't count,
-- so a deal can get a new one after the old one is closed.
CREATE UNIQUE INDEX task_hrdc_deadline_open_uq ON task (deal_id)
  WHERE type = 'hrdc_deadline' AND done_at IS NULL;

COMMIT;
