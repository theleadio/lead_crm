-- =============================================================================
-- 006: seats and class.status live in the database (Spec §12.1)
-- Decided 5 Oct 2026 (Shawn), from Zixuan's 9.8 question. Owner: Shawn.
--
-- Why in the database: enrolments are written by Zixuan's service, by the
-- Stripe webhook (§11.2), by the SalesProcess import, and by hand in SQL.
-- A rule that has to hold for every writer can't live in one writer's code.
--
-- 1. class_seats_taken(class)   — the one definition of a taken seat
-- 2. class_status_for(...)      — the one mapping from seats to status
-- 3. enrolment: fill seat_reserved_until, refuse overselling, refresh status
-- 4. class: capacity/threshold/publish edits recompute status in the same row
-- 5. class: any status or is_public change writes ClassPublished to the outbox
-- 6. expire_reservations()      — turns expired reservations into real writes
-- 7. one-off recompute of every class, privileges
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Taken seats. A reservation counts only until seat_reserved_until, so the
--    seat check is right even between expiry sweeps.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION class_seats_taken(p_class uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM enrolment
  WHERE class_id = p_class
    AND (status IN ('payment_pending','confirmed','onboarded','attended','completed')
         OR (status = 'reserved' AND seat_reserved_until > now()));
$$;

-- Statuses that hold a seat (a live reservation included).
CREATE OR REPLACE FUNCTION enrolment_takes_seat(p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('reserved','payment_pending','confirmed','onboarded','attended','completed');
$$;

-- -----------------------------------------------------------------------------
-- 2. Seats → status. Only for classes that are published; draft, cancelled
--    and completed are set by people and never touched here.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION class_status_for(p_capacity integer, p_threshold integer, p_taken integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_capacity - p_taken <= 0           THEN 'full'
    WHEN p_capacity - p_taken <= p_threshold THEN 'few_seats'
    ELSE 'open' END;
$$;

CREATE OR REPLACE FUNCTION refresh_class_status(p_class uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  c class%ROWTYPE;
  v_new text;
BEGIN
  -- Lock first, count second: the count then sees every enrolment committed
  -- before we got the lock.
  SELECT * INTO c FROM class WHERE id = p_class FOR UPDATE;
  IF NOT FOUND OR c.status NOT IN ('open','few_seats','full') THEN
    RETURN c.status;
  END IF;
  v_new := class_status_for(c.capacity, c.few_seats_threshold, class_seats_taken(p_class));
  IF v_new <> c.status THEN
    UPDATE class SET status = v_new WHERE id = p_class;
  END IF;
  RETURN v_new;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Enrolment triggers
-- -----------------------------------------------------------------------------
-- 3a. Every reservation gets an expiry, whoever wrote it.
CREATE OR REPLACE FUNCTION enrolment_fill_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_hours numeric;
BEGIN
  IF NEW.status = 'reserved' AND NEW.seat_reserved_until IS NULL THEN
    SELECT (value #>> '{}')::numeric INTO v_hours FROM app_setting WHERE key = 'reservation_expiry_hours';
    NEW.seat_reserved_until := now() + make_interval(hours => coalesce(v_hours, 48)::integer);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enrolment_fill_reservation BEFORE INSERT OR UPDATE OF status, seat_reserved_until ON enrolment
  FOR EACH ROW EXECUTE FUNCTION enrolment_fill_reservation();

-- 3b. After any change that can move a seat: refuse overselling, then refresh
--     the class (and the old class, when an enrolment moves).
CREATE OR REPLACE FUNCTION enrolment_seats_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c class%ROWTYPE;
  v_claims boolean := false;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    -- Does this write claim a seat it didn't hold before?
    v_claims := enrolment_takes_seat(NEW.status)
      AND (TG_OP = 'INSERT'
           OR OLD.class_id <> NEW.class_id
           OR NOT enrolment_takes_seat(OLD.status)
           OR (OLD.status = 'reserved' AND OLD.seat_reserved_until <= now()));
    SELECT * INTO c FROM class WHERE id = NEW.class_id FOR UPDATE;
    IF v_claims AND c.status NOT IN ('cancelled','completed')
       AND class_seats_taken(NEW.class_id) > c.capacity THEN
      RAISE EXCEPTION 'no_seats: class % is full', c.code
        USING ERRCODE = 'P0001', HINT = 'Raise the capacity first, or choose another class.';
    END IF;
    PERFORM refresh_class_status(NEW.class_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_class_status(OLD.class_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.class_id <> NEW.class_id THEN
    PERFORM refresh_class_status(OLD.class_id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER enrolment_seats_changed
  AFTER INSERT OR DELETE OR UPDATE OF status, class_id, seat_reserved_until ON enrolment
  FOR EACH ROW EXECUTE FUNCTION enrolment_seats_changed();

-- -----------------------------------------------------------------------------
-- 4. Class edits: capacity, threshold, or publishing (draft → open) recompute
--    status in the same UPDATE. A person sets 'open' to publish; the database
--    corrects it to few_seats/full straight away if needed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION class_fix_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('open','few_seats','full')
     AND (OLD.capacity IS DISTINCT FROM NEW.capacity
          OR OLD.few_seats_threshold IS DISTINCT FROM NEW.few_seats_threshold
          OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.status := class_status_for(NEW.capacity, NEW.few_seats_threshold, class_seats_taken(NEW.id));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER class_fix_status BEFORE UPDATE ON class
  FOR EACH ROW EXECUTE FUNCTION class_fix_status();

-- A new class that starts published gets the right status too.
CREATE OR REPLACE FUNCTION class_fix_status_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('open','few_seats','full') THEN
    NEW.status := class_status_for(NEW.capacity, NEW.few_seats_threshold, 0);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER class_fix_status_insert BEFORE INSERT ON class
  FOR EACH ROW EXECUTE FUNCTION class_fix_status_insert();

-- -----------------------------------------------------------------------------
-- 5. ClassPublished (§11.1: "is_public or status changes") is written here, so
--    it fires for seat-driven changes too. The app stops raising it itself.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION class_published_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
  VALUES ('ClassPublished', 'class', NEW.id, jsonb_build_object(
    'classId', NEW.id, 'fromStatus', OLD.status, 'toStatus', NEW.status,
    'fromPublic', OLD.is_public, 'toPublic', NEW.is_public));
  RETURN NULL;
END $$;

CREATE TRIGGER class_published_event AFTER UPDATE ON class
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_public IS DISTINCT FROM NEW.is_public)
  EXECUTE FUNCTION class_published_event();

-- -----------------------------------------------------------------------------
-- 6. Expiry becomes a real write: reserved → cancelled. That frees the seat,
--    lets the person book the same class again (the double-booking index
--    still counts a 'reserved' row), and tells Shawn's workers.
--    Run every 15 minutes by Supabase Cron (see 7). Safe to run any time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_reservations() RETURNS integer
LANGUAGE sql AS $$
  WITH x AS (
    UPDATE enrolment
       SET status = 'cancelled', cancelled_reason = 'reservation_expired'
     WHERE status = 'reserved' AND seat_reserved_until <= now()
    RETURNING id, person_id, class_id
  ), ev AS (
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
    SELECT 'EnrolmentCancelled', 'enrolment', id,
           jsonb_build_object('enrolmentId', id, 'reason', 'reservation_expired')
      FROM x
    RETURNING 1
  )
  SELECT count(*)::integer FROM ev;
$$;

-- -----------------------------------------------------------------------------
-- 6b. Stripe-path hold. A Stripe Checkout link lives at most 24 hours, so a
--     reservation made by POST /api/public/register sets seat_reserved_until
--     to now() + this value and passes the same time to Stripe as expires_at.
--     reservation_expiry_hours (48) stays for reservations staff make.
--     Decided 5 Oct (Shawn). Must stay between 0.5 and 24 (Stripe's limits).
-- -----------------------------------------------------------------------------
INSERT INTO app_setting (key, value) VALUES ('stripe_reservation_hours', '24')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Fix every existing class once, then privileges.
--    Schedule the sweep on Supabase (not part of this file, pg_cron is
--    Supabase-only here):
--      select cron.schedule('expire-reservations', '*/15 * * * *',
--                           $$select expire_reservations()$$);
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM class WHERE status IN ('open','few_seats','full') LOOP
    PERFORM refresh_class_status(r.id);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION class_seats_taken(uuid)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_class_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expire_reservations()      FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION class_seats_taken(uuid) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION refresh_class_status(uuid) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION expire_reservations() FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
