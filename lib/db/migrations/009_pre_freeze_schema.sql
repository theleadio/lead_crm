-- =============================================================================
-- LEAD CRM — migration 009
-- Pre-freeze schema review of 8 Oct 2026 (docs/superpowers/notes/
-- 2026-10-08-pre-freeze-schema-review.md), decisions O23–O30, O32, O33.
-- The schema freezes on 16 Oct; these are the gaps Zixuan would otherwise code
-- against. Not here: S-02 (convention, no DDL), S-09 (no DDL), S-12/S-13 (010).
-- Numbered 009 because 006 (class seats), 007 (reservation holds) and 008 (proof uniqueness) were
-- already taken on feat/classes; seats, class status and the reservation
-- hold CHECK live there, so this file has no seat or expiry logic of its own.
--
--  1. S-11 (O33) task: done_by needs done_at, but done_at no longer needs
--     done_by, so a worker (system actor = NULL) can close a task. Replaces
--     001's unnamed CHECK ((done_at IS NULL) = (done_by IS NULL)).
--  2. S-01 (O23) task.payment_id. A match_payment task must point at its
--     payment, and only one can be open per payment.
--  3. S-10 (O32) task.is_cancelled. A withdrawn task is closed (done_at set)
--     AND flagged, so the timeline can say "withdrawn" instead of "done".
--  4. S-03 (O25) payment: refunded_at; status, paid_at and refunded amount
--     must agree; stripe_checkout_session_id unique; view payment_net is the
--     one revenue definition (spec 12.7).
--  5. S-04 (O26) enrolment_status_history, append-only, like
--     deal_stage_history, written by a DATABASE TRIGGER on enrolment (insert
--     and every status change), so the status-move screen, the Stripe webhook,
--     imports, expire_reservations() and a class cancel are all covered. The
--     24th table.
--  6. S-05 (O27) class.notes / cancelled_reason / cancelled_at. A trigger
--     stamps cancelled_at when a class becomes cancelled; the reason is
--     written by the cancel service (the database cannot invent one).
--     deal.hrdc_document_key.
--  7. S-06 (O28) is NOT here: 007_reservation_holds.sql has the CHECK
--     (enrolment_reserved_has_hold) and the backfill. This file only adds the
--     partial index that expire_reservations() scans.
--  8. S-07 (O29) touchpoint.external_ref, unique per channel. Frozen like
--     every other touchpoint column: forbid_change() (002) compares
--     to_jsonb(NEW) - person_id - is_first_touch, so a new column is covered
--     without changing the function.
--  9. S-08 (O30) deal.source_touchpoint_id.
--
-- Backfills (each runs before the constraint it satisfies):
--   * payment.paid_at: succeeded / partially_refunded / refunded rows with no
--     paid_at get paid_at = created_at (when the row was recorded, the best
--     date we have; for a webhook or a same-day manual entry it is the day it
--     was paid).
--   * payment.refunded_at: rows with refunded_amount_myr > 0 get
--     refunded_at = updated_at (the last change to the row; the column is new,
--     so no row has a real value).
--   * payment rows whose status and refunded_amount_myr disagree are NOT
--     repaired: either side could be the wrong one and both are money. The
--     migration stops with the count, to be fixed by hand. That includes
--     partially_refunded with 0 refunded (the old deals-db test fixture): no
--     refund amount can be invented for it, and calling it succeeded would
--     hide a refund that may have happened. Duplicate checkout session ids
--     also stop the migration, with the count.
--   * enrolment_status_history: one row per existing enrolment,
--     NULL -> current status, changed_at = enrolment.created_at, reason
--     'migration 009 backfill', changed_by NULL. It is the only history there
--     is: it says "had this status by now", not "changed on that date".
--   * class: cancelled classes get cancelled_reason 'migration 009 backfill'
--     and cancelled_at = updated_at.
--
-- What writers must now do: set task.payment_id on match_payment tasks; set
-- paid_at when a payment succeeds and refunded_at with every refund; set
-- status to match the refunded amount; set is_cancelled (and done_at) when
-- withdrawing a task; give a reason when cancelling a class. Enrolment status
-- history needs nothing from a writer: the trigger does it.
--
-- Applied once, in order, like 001–007. Re-running it is harmless: columns,
-- indexes, the table and the view use IF NOT EXISTS / OR REPLACE, constraints
-- are dropped and re-added, and the backfills only touch rows still missing
-- the value. Owner: Shawn. 8 Oct 2026.
-- =============================================================================

BEGIN;
SET LOCAL client_min_messages = warning;   -- quiet the "does not exist, skipping" notices

-- -----------------------------------------------------------------------------
-- 1. S-11 task: done_by needs done_at (not the other way round)
--    001's CHECK has a generated name (task_check1 on a fresh database), so
--    find it by its definition instead of trusting the name.
-- -----------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'task'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) = 'CHECK (((done_at IS NULL) = (done_by IS NULL)))'
  LOOP
    EXECUTE format('ALTER TABLE task DROP CONSTRAINT %I', c);
  END LOOP;
  -- Post-condition: if another PostgreSQL version prints the old CHECK
  -- differently, the match above finds nothing. Stop rather than leave it.
  -- The only CHECK on task allowed to mention done_by is the one added below.
  SELECT string_agg(conname, ', ') INTO c FROM pg_constraint
  WHERE conrelid = 'task'::regclass AND contype = 'c'
    AND conname <> 'task_done_by_needs_done_at'
    AND pg_get_constraintdef(oid) LIKE '%done_by%';
  IF c IS NOT NULL THEN
    RAISE EXCEPTION 'migration 009: old done_at/done_by CHECK on task not removed: %', c
      USING HINT = 'Drop it by hand (\d task), then re-run.';
  END IF;
END $$;

ALTER TABLE task
  DROP CONSTRAINT IF EXISTS task_done_by_needs_done_at,
  ADD CONSTRAINT task_done_by_needs_done_at
    CHECK (done_by IS NULL OR done_at IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 2. S-01 match_payment task -> payment
--    Same pattern as 004's hrdc_deadline guard. A second webhook for the same
--    payment fails on the index instead of opening a second task.
-- -----------------------------------------------------------------------------
ALTER TABLE task ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES payment(id);
ALTER TABLE task
  DROP CONSTRAINT IF EXISTS task_match_payment_needs_payment,
  ADD CONSTRAINT task_match_payment_needs_payment
    CHECK (type <> 'match_payment' OR payment_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS task_match_payment_open_uq ON task (payment_id)
  WHERE type = 'match_payment' AND done_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. S-10 withdrawn tasks
--    A flag, not a new state: every "done_at IS NULL" predicate keeps meaning
--    "open" (004's index, the assignee index, Home, merge_person).
-- -----------------------------------------------------------------------------
ALTER TABLE task ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE task
  DROP CONSTRAINT IF EXISTS task_cancelled_is_closed,
  ADD CONSTRAINT task_cancelled_is_closed CHECK (NOT is_cancelled OR done_at IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 4. S-03 payment integrity
-- -----------------------------------------------------------------------------
ALTER TABLE payment ADD COLUMN IF NOT EXISTS refunded_at timestamptz;   -- last refund

-- refunded_at first: any UPDATE moves updated_at, so the paid_at backfill
-- would otherwise overwrite the date this one reads.
UPDATE payment SET refunded_at = updated_at
WHERE refunded_at IS NULL AND refunded_amount_myr > 0;
UPDATE payment SET paid_at = created_at
WHERE paid_at IS NULL AND status IN ('succeeded','partially_refunded','refunded');

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM payment
  WHERE NOT ((status = 'refunded'           AND refunded_amount_myr = amount_myr)
          OR (status = 'partially_refunded' AND refunded_amount_myr > 0 AND refunded_amount_myr < amount_myr)
          OR (status NOT IN ('refunded','partially_refunded') AND refunded_amount_myr = 0));
  IF n > 0 THEN
    RAISE EXCEPTION 'migration 009: % payment row(s) have a status that does not match refunded_amount_myr', n
      USING HINT = 'Fix them by hand (status or refunded amount), then re-run. Find them with the '
                   'payment_refund_matches_status condition in this file.';
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT stripe_checkout_session_id FROM payment
    WHERE stripe_checkout_session_id IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'migration 009: % stripe_checkout_session_id value(s) are used by more than one payment', n;
  END IF;
END $$;

ALTER TABLE payment
  DROP CONSTRAINT IF EXISTS payment_paid_at_when_paid,
  ADD CONSTRAINT payment_paid_at_when_paid
    CHECK (status NOT IN ('succeeded','partially_refunded','refunded') OR paid_at IS NOT NULL),
  DROP CONSTRAINT IF EXISTS payment_refund_matches_status,
  ADD CONSTRAINT payment_refund_matches_status CHECK (
       (status = 'refunded'           AND refunded_amount_myr = amount_myr)
    OR (status = 'partially_refunded' AND refunded_amount_myr > 0 AND refunded_amount_myr < amount_myr)
    OR (status NOT IN ('refunded','partially_refunded') AND refunded_amount_myr = 0)),
  DROP CONSTRAINT IF EXISTS payment_refunded_at_when_refunded,
  ADD CONSTRAINT payment_refunded_at_when_refunded
    CHECK ((refunded_amount_myr > 0) = (refunded_at IS NOT NULL));

-- checkout.session.completed / async_payment_succeeded look the payment up by session.
CREATE UNIQUE INDEX IF NOT EXISTS payment_stripe_session_uq ON payment (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- The one revenue definition (spec 12.7): money received, net of refunds.
-- Pending and failed payments are not revenue. Lifecycle, company totals and
-- BI read this instead of writing their own status list.
CREATE OR REPLACE VIEW payment_net AS
  SELECT id, enrolment_id, deal_id, method, status, amount_myr, refunded_amount_myr,
         amount_myr - refunded_amount_myr AS net_myr, paid_at, refunded_at
  FROM payment
  WHERE status IN ('succeeded','partially_refunded','refunded');

-- -----------------------------------------------------------------------------
-- 5. S-04 enrolment status history (append-only, system-written: no version)
--    clock_timestamp() so two changes in one transaction stay in order.
--    Written by a trigger, not by application code (spec 3: a rule every
--    writer needs lives in the database). changed_by stays NULL: the database
--    does not know the actor; the audit_log row of the status move has it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrolment_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES app_user(id),
  enrolment_id  uuid NOT NULL REFERENCES enrolment(id),
  from_status   text,
  to_status     text NOT NULL,
  reason        text,
  changed_by    uuid REFERENCES app_user(id),
  changed_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS enrolment_status_history_enrolment_idx
  ON enrolment_status_history (enrolment_id, changed_at);
CREATE OR REPLACE TRIGGER enrolment_status_history_append_only
  BEFORE UPDATE OR DELETE ON enrolment_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO enrolment_status_history (enrolment_id, from_status, to_status, reason, changed_by, changed_at)
  SELECT e.id, NULL, e.status, 'migration 009 backfill', NULL, e.created_at
  FROM enrolment e
  WHERE NOT EXISTS (SELECT 1 FROM enrolment_status_history h WHERE h.enrolment_id = e.id);

-- AFTER trigger: a write that 006's seat guard refuses rolls back and leaves
-- no history. reason is the cancel reason when the new status is cancelled.
CREATE OR REPLACE FUNCTION enrolment_log_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO enrolment_status_history (enrolment_id, from_status, to_status, reason)
  VALUES (NEW.id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
          NEW.status,
          CASE WHEN NEW.status = 'cancelled' THEN NEW.cancelled_reason END);
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER enrolment_log_status_insert AFTER INSERT ON enrolment
  FOR EACH ROW EXECUTE FUNCTION enrolment_log_status();
CREATE OR REPLACE TRIGGER enrolment_log_status_update AFTER UPDATE OF status ON enrolment
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enrolment_log_status();

-- -----------------------------------------------------------------------------
-- 6. S-05 class notes and cancellation; HRDC document
--    class.notes is internal: the public schedule feed (spec 8.1) never
--    selects it. The cancel service (lib/classes/service.ts) writes
--    cancelled_reason; the trigger below stamps cancelled_at for any writer.
--    No CHECK on the reason: fixtures and hand-run SQL cancel classes too, and
--    the database cannot make up a reason. cancelled_at is always present.
-- -----------------------------------------------------------------------------
ALTER TABLE class
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE class SET cancelled_reason = coalesce(cancelled_reason, 'migration 009 backfill'),
                 cancelled_at     = coalesce(cancelled_at, updated_at)
WHERE status = 'cancelled' AND (cancelled_reason IS NULL OR cancelled_at IS NULL);

CREATE OR REPLACE FUNCTION class_stamp_cancelled() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' THEN
    NEW.cancelled_at := coalesce(NEW.cancelled_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER class_stamp_cancelled BEFORE INSERT OR UPDATE OF status ON class
  FOR EACH ROW EXECUTE FUNCTION class_stamp_cancelled();

ALTER TABLE class
  DROP CONSTRAINT IF EXISTS class_cancelled_at_recorded,
  ADD CONSTRAINT class_cancelled_at_recorded
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL);

ALTER TABLE deal ADD COLUMN IF NOT EXISTS hrdc_document_key text;

-- -----------------------------------------------------------------------------
-- 7. S-06 index for the expiry sweep. The "a reserved row has a hold" CHECK
--    and its backfill are 007_reservation_holds.sql; not repeated here.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS enrolment_reservation_expiry_idx ON enrolment (seat_reserved_until)
  WHERE status = 'reserved';                                        -- the sweep's scan

-- -----------------------------------------------------------------------------
-- 8. S-07 touchpoint external reference
--    '<batch>:<row>' for import, leadgen_id for Lead Ads, the WATI message id,
--    the public form's idempotencyKey. Insert with ON CONFLICT DO NOTHING.
-- -----------------------------------------------------------------------------
ALTER TABLE touchpoint ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_external_ref_uq ON touchpoint (channel, external_ref)
  WHERE external_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9. S-08 deal attribution
--    Set by public intake, n8n and WATI. Deals created by hand leave it NULL.
-- -----------------------------------------------------------------------------
ALTER TABLE deal ADD COLUMN IF NOT EXISTS source_touchpoint_id uuid REFERENCES touchpoint(id);

COMMIT;
