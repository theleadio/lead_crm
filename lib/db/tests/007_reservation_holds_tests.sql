-- Tests for migration 007. Run on an empty database after 001-007. Rolls itself back.
-- To recreate rows written before 006 (reserved, no hold), each scenario drops
-- the CHECK and switches off the fill trigger inside this transaction only.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;
CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text, msg_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, false);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name, SQLERRM LIKE msg_like); END;
END $$;

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'AIM', 'AI Mastery', 'mastery', 2);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c1a55', '00000000-0000-0000-0000-00000000c001', 'K1', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 5, 1, 'open'),
  ('00000000-0000-0000-0000-0000000c1a56', '00000000-0000-0000-0000-00000000c001', 'K2', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 1, 0, 'open');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'A', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'B', 'b@x.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'C', 'c@x.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'D', 'd@x.com');

SELECT pg_temp.check('CHECK enrolment_reserved_has_hold exists',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrolment_reserved_has_hold'));

-- Recreate pre-006 rows: one 10 days old, one 1 hour old, no hold
ALTER TABLE enrolment DROP CONSTRAINT enrolment_reserved_has_hold;
ALTER TABLE enrolment DISABLE TRIGGER enrolment_fill_reservation;
INSERT INTO enrolment (person_id, class_id, status, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1a55', 'reserved', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000c1a55', 'reserved', now() - interval '1 hour');
ALTER TABLE enrolment ENABLE TRIGGER enrolment_fill_reservation;
SELECT pg_temp.check('setup: two reservations with no hold, holding no seat',
  (SELECT count(*) = 2 FROM enrolment WHERE status = 'reserved' AND seat_reserved_until IS NULL)
  AND class_seats_taken('00000000-0000-0000-0000-0000000c1a55') = 0);

CREATE TEMP TABLE n (step text, v int);
INSERT INTO n SELECT 'backfill', backfill_reservation_holds();
SELECT pg_temp.check('backfill gives both a hold of created_at + 48h',
  (SELECT v = 2 FROM n WHERE step = 'backfill')
  AND (SELECT bool_and(seat_reserved_until = created_at + interval '48 hours') FROM enrolment WHERE status = 'reserved'));
SELECT pg_temp.check('the recent one now holds a seat, the old one does not',
  class_seats_taken('00000000-0000-0000-0000-0000000c1a55') = 1);
INSERT INTO n SELECT 'expire', expire_reservations();
SELECT pg_temp.check('sweep cancels the old one only',
  (SELECT v = 1 FROM n WHERE step = 'expire')
  AND (SELECT status = 'cancelled' AND cancelled_reason = 'reservation_expired' FROM enrolment WHERE person_id = '00000000-0000-0000-0000-0000000000a1')
  AND (SELECT status = 'reserved' FROM enrolment WHERE person_id = '00000000-0000-0000-0000-0000000000a2'));
INSERT INTO enrolment (person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1a55', 'reserved');
SELECT pg_temp.check('the person from the stuck reservation can book again',
  (SELECT count(*) = 2 FROM enrolment WHERE person_id = '00000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.check('class status follows: 2 of 5 taken, threshold 1 → open',
  (SELECT status = 'open' FROM class WHERE code = 'K1'));

-- Guard fix: a no-hold reservation that gets a hold on a full class is refused
INSERT INTO enrolment (person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000c1a56', 'confirmed');
ALTER TABLE enrolment DISABLE TRIGGER enrolment_fill_reservation;
INSERT INTO enrolment (person_id, class_id, status, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000c1a56', 'reserved', now() - interval '1 hour');
ALTER TABLE enrolment ENABLE TRIGGER enrolment_fill_reservation;
SELECT pg_temp.expect_fail('giving a no-hold reservation a hold on a full class is refused',
  $q$UPDATE enrolment SET seat_reserved_until = now() + interval '1 day' WHERE person_id = '00000000-0000-0000-0000-0000000000a4'$q$,
  'no_seats%');
SELECT pg_temp.expect_fail('backfill stops with no_seats instead of overselling',
  $q$SELECT backfill_reservation_holds()$q$, 'no_seats: class K2%');
SELECT pg_temp.check('K2 still has exactly 1 seat taken',
  class_seats_taken('00000000-0000-0000-0000-0000000c1a56') = 1);
DELETE FROM enrolment WHERE person_id = '00000000-0000-0000-0000-0000000000a4';

-- The CHECK
ALTER TABLE enrolment ADD CONSTRAINT enrolment_reserved_has_hold
  CHECK (status <> 'reserved' OR seat_reserved_until IS NOT NULL);
SELECT pg_temp.check('CHECK re-added without error once no-hold rows are gone', true);
INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until) VALUES
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000c1a55', 'reserved', NULL);
SELECT pg_temp.check('a writer that sends no hold still passes: the trigger fills it',
  (SELECT seat_reserved_until IS NOT NULL FROM enrolment WHERE person_id = '00000000-0000-0000-0000-0000000000a4'));
ALTER TABLE enrolment DISABLE TRIGGER enrolment_fill_reservation;
SELECT pg_temp.expect_fail('with the trigger off, a reserved row with no hold is refused by the CHECK',
  $q$UPDATE enrolment SET seat_reserved_until = NULL WHERE person_id = '00000000-0000-0000-0000-0000000000a4'$q$,
  '%enrolment_reserved_has_hold%');
ALTER TABLE enrolment ENABLE TRIGGER enrolment_fill_reservation;

-- Privileges
CREATE ROLE lead_test_nobody7 NOLOGIN;
SELECT pg_temp.check('backfill not callable by other roles',
  NOT has_function_privilege('lead_test_nobody7', 'backfill_reservation_holds()', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
