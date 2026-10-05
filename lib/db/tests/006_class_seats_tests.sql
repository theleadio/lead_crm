-- Tests for migration 006. Run on an empty database after 001-006. Rolls itself back.
-- Writes run as their own statement before the check that reads them.
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
CREATE FUNCTION pg_temp.st(p_code text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM class WHERE code = p_code;
$$;

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'AIM', 'AI Mastery', 'mastery', 2);
-- Capacity 5, few_seats at 2 or fewer available.
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c1a55', '00000000-0000-0000-0000-00000000c001', 'K1', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 5, 2, 'open'),
  ('00000000-0000-0000-0000-0000000c1a56', '00000000-0000-0000-0000-00000000c001', 'K2', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 5, 2, 'draft'),
  ('00000000-0000-0000-0000-0000000c1a57', '00000000-0000-0000-0000-00000000c001', 'K3', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 1, 0, 'full');
INSERT INTO person (id, full_name, email)
SELECT ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'P' || g, 'p' || g || '@x.com'
FROM generate_series(1, 9) g;
CREATE FUNCTION pg_temp.p(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid;
$$;

SELECT pg_temp.check('a new published class with no seats taken is open, whatever was typed',
  pg_temp.st('K3') = 'open');

-- Filling K1
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(1), '00000000-0000-0000-0000-0000000c1a55', 'confirmed');
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(2), '00000000-0000-0000-0000-0000000c1a55', 'confirmed');
SELECT pg_temp.check('2 of 5 taken: open', pg_temp.st('K1') = 'open');
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(3), '00000000-0000-0000-0000-0000000c1a55', 'payment_pending');
SELECT pg_temp.check('3 of 5 taken (2 left = threshold): few_seats', pg_temp.st('K1') = 'few_seats');
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(4), '00000000-0000-0000-0000-0000000c1a55', 'reserved');
SELECT pg_temp.check('reservation gets an expiry from app_setting (48h)',
  (SELECT seat_reserved_until BETWEEN now() + interval '47 hours' AND now() + interval '49 hours'
   FROM enrolment WHERE person_id = pg_temp.p(4)));
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(5), '00000000-0000-0000-0000-0000000c1a55', 'reserved');
SELECT pg_temp.check('5 of 5 taken: full', pg_temp.st('K1') = 'full');

-- Overselling refused, from any writer
SELECT pg_temp.expect_fail('6th seat refused with no_seats',
  $q$INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(6), '00000000-0000-0000-0000-0000000c1a55', 'confirmed')$q$,
  'no_seats%');
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(6), '00000000-0000-0000-0000-0000000c1a55', 'waitlisted');
SELECT pg_temp.check('a waitlisted row is allowed on a full class and takes no seat', pg_temp.st('K1') = 'full');
SELECT pg_temp.expect_fail('waitlisted → reserved on a full class refused',
  $q$UPDATE enrolment SET status = 'reserved' WHERE person_id = pg_temp.p(6)$q$, 'no_seats%');

-- Moving between seat-taking statuses never trips the guard
UPDATE enrolment SET status = 'onboarded' WHERE person_id = pg_temp.p(1);
SELECT pg_temp.check('confirmed → onboarded on a full class is fine', pg_temp.st('K1') = 'full');

-- A seat frees up
UPDATE enrolment SET status = 'cancelled' WHERE person_id = pg_temp.p(2);
SELECT pg_temp.check('a cancellation frees a seat: full → few_seats', pg_temp.st('K1') = 'few_seats');

-- Expiry: counts stop at once, the sweep makes it a write
UPDATE enrolment SET seat_reserved_until = now() - interval '1 minute' WHERE person_id = pg_temp.p(4);
SELECT pg_temp.check('an expired reservation stops counting before the sweep runs',
  class_seats_taken('00000000-0000-0000-0000-0000000c1a55') = 3);
CREATE TEMP TABLE n (v int);
INSERT INTO n SELECT expire_reservations();
SELECT pg_temp.check('sweep cancels exactly the expired reservation',
  (SELECT v = 1 FROM n)
  AND (SELECT status = 'cancelled' AND cancelled_reason = 'reservation_expired' FROM enrolment WHERE person_id = pg_temp.p(4))
  AND (SELECT status = 'reserved' FROM enrolment WHERE person_id = pg_temp.p(5)));
SELECT pg_temp.check('sweep writes EnrolmentCancelled with the reason',
  EXISTS (SELECT 1 FROM event_outbox WHERE type = 'EnrolmentCancelled' AND payload->>'reason' = 'reservation_expired'));
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(4), '00000000-0000-0000-0000-0000000c1a55', 'reserved');
SELECT pg_temp.check('after expiry the same person can book the same class again',
  (SELECT count(*) = 2 FROM enrolment WHERE person_id = pg_temp.p(4)));

-- People-set statuses are never overwritten
INSERT INTO enrolment (person_id, class_id, status) VALUES (pg_temp.p(1), '00000000-0000-0000-0000-0000000c1a56', 'confirmed');
SELECT pg_temp.check('draft class stays draft when enrolments arrive', pg_temp.st('K2') = 'draft');
UPDATE class SET status = 'cancelled' WHERE code = 'K1';
UPDATE enrolment SET status = 'cancelled' WHERE person_id = pg_temp.p(3) AND class_id = '00000000-0000-0000-0000-0000000c1a55';
SELECT pg_temp.check('cancelled class stays cancelled when seats free up', pg_temp.st('K1') = 'cancelled');
UPDATE class SET status = 'few_seats' WHERE code = 'K1';

-- Class edits
UPDATE class SET capacity = 20 WHERE code = 'K1';
SELECT pg_temp.check('raising capacity recomputes status in the same update', pg_temp.st('K1') = 'open');
UPDATE class SET capacity = 3 WHERE code = 'K1';
SELECT pg_temp.check('lowering capacity to the seats taken makes it full', pg_temp.st('K1') = 'full');
UPDATE class SET status = 'open', capacity = 1 WHERE code = 'K2';
SELECT pg_temp.check('publishing a draft (status open) corrects to full when already full', pg_temp.st('K2') = 'full');

-- Transfer refreshes both classes
UPDATE class SET capacity = 5 WHERE code = 'K2';
UPDATE enrolment SET class_id = '00000000-0000-0000-0000-0000000c1a56' WHERE person_id = pg_temp.p(5) AND class_id = '00000000-0000-0000-0000-0000000c1a55';
SELECT pg_temp.check('moving an enrolment refreshes the old class and the new one',
  pg_temp.st('K1') = 'few_seats' AND pg_temp.st('K2') = 'open');

-- Events
SELECT pg_temp.check('seat-driven status changes write ClassPublished',
  (SELECT count(*) >= 4 FROM event_outbox WHERE type = 'ClassPublished' AND aggregate_id = '00000000-0000-0000-0000-0000000c1a55'));
SELECT pg_temp.check('ClassPublished carries from/to',
  EXISTS (SELECT 1 FROM event_outbox WHERE type = 'ClassPublished' AND payload->>'fromStatus' = 'full' AND payload->>'toStatus' = 'few_seats'));

-- Completed classes accept history (imports)
UPDATE class SET status = 'completed', capacity = 1 WHERE code = 'K3';
INSERT INTO enrolment (person_id, class_id, status, completed_at) VALUES (pg_temp.p(7), '00000000-0000-0000-0000-0000000c1a57', 'completed', now());
INSERT INTO enrolment (person_id, class_id, status, completed_at) VALUES (pg_temp.p(8), '00000000-0000-0000-0000-0000000c1a57', 'completed', now());
SELECT pg_temp.check('a completed class can be imported over capacity and stays completed', pg_temp.st('K3') = 'completed');

SELECT pg_temp.check('stripe_reservation_hours setting is 24',
  (SELECT value #>> '{}' = '24' FROM app_setting WHERE key = 'stripe_reservation_hours'));
UPDATE enrolment SET seat_reserved_until = NULL WHERE person_id = pg_temp.p(4) AND status = 'reserved';
SELECT pg_temp.check('a reservation whose hold is cleared gets a new one',
  (SELECT seat_reserved_until > now() FROM enrolment WHERE person_id = pg_temp.p(4) AND status = 'reserved'));

-- Privileges
CREATE ROLE lead_test_nobody6 NOLOGIN;
SELECT pg_temp.check('seat count and sweep not callable by other roles',
  NOT has_function_privilege('lead_test_nobody6', 'class_seats_taken(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('lead_test_nobody6', 'expire_reservations()', 'EXECUTE')
  AND NOT has_function_privilege('lead_test_nobody6', 'refresh_class_status(uuid)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
