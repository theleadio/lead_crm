-- =============================================================================
-- 007: no reservation without a hold
-- 6 Oct 2026. Owner: Shawn. From Zixuan's review of 006.
--
-- 006 fills seat_reserved_until only when a row is written. Reserved rows that
-- existed before 006 kept NULL: they hold no seat, expire_reservations() skips
-- them, so they stay reserved forever and the double-booking index stops that
-- person booking the class again (Zixuan's catch, reproduced 6 Oct).
-- Second bug, in 006's seat guard: when such a row later got a hold, the
-- "did it hold a seat before?" test compared NULL <= now(), got NULL, and the
-- guard was skipped — a 1-seat class could end up with 2 seats taken
-- (reproduced 6 Oct).
--
-- 1. Seat guard: a reservation with no hold counts as not holding a seat.
-- 2. backfill_reservation_holds(): hold = created_at + reservation_expiry_hours.
--    Old rows come out already expired and the sweep cancels them; recent rows
--    keep the rest of their 48 hours. If that would oversell a class the
--    guard stops the whole migration with no_seats and the class code — a
--    person decides, nothing is cancelled silently.
-- 3. Run the sweep once.
-- 4. CHECK: a reserved row must have a hold. The 006 trigger fills it before
--    the CHECK runs, so every writer still passes.
-- =============================================================================

BEGIN;

-- 1. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrolment_seats_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c class%ROWTYPE;
  v_claims boolean := false;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    -- Does this write claim a seat it didn't hold before?
    -- coalesce: a reservation with no hold (NULL) did not hold a seat.
    v_claims := enrolment_takes_seat(NEW.status)
      AND (TG_OP = 'INSERT'
           OR OLD.class_id <> NEW.class_id
           OR NOT enrolment_takes_seat(OLD.status)
           OR (OLD.status = 'reserved' AND coalesce(OLD.seat_reserved_until <= now(), true)));
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

-- 2. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION backfill_reservation_holds() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_hours numeric;
  v_count integer := 0;
  r record;
BEGIN
  SELECT (value #>> '{}')::numeric INTO v_hours FROM app_setting WHERE key = 'reservation_expiry_hours';
  -- One row at a time, oldest first, so a no_seats error always names the
  -- same reservation (a single UPDATE has no guaranteed row order).
  FOR r IN SELECT id FROM enrolment
            WHERE status = 'reserved' AND seat_reserved_until IS NULL
            ORDER BY created_at, id LOOP
    UPDATE enrolment
       SET seat_reserved_until = created_at + make_interval(hours => coalesce(v_hours, 48)::integer)
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION backfill_reservation_holds() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION backfill_reservation_holds() FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- 3. -------------------------------------------------------------------------
SELECT backfill_reservation_holds();
SELECT expire_reservations();

-- 4. -------------------------------------------------------------------------
ALTER TABLE enrolment ADD CONSTRAINT enrolment_reserved_has_hold
  CHECK (status <> 'reserved' OR seat_reserved_until IS NOT NULL);

COMMIT;
