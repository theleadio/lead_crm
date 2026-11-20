-- Tests for migration 030. Run after 001-029. Rolled back.
-- Runs the migration's UPDATE on test seats (the migration file itself has its
-- own BEGIN/COMMIT, so its statement is repeated here).
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c030', 'C30', 'Seat Price Course', 'mastery', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c3001', '00000000-0000-0000-0000-00000000c030', 'P30', current_date + 30, current_date + 30, 'en', 'online', 'https://x', 30, 5, 'open');
INSERT INTO person (id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000030a1', 'Price Test A'),
  ('00000000-0000-0000-0000-0000000030a2', 'Price Test B'),
  ('00000000-0000-0000-0000-0000000030a3', 'Price Test C'),
  ('00000000-0000-0000-0000-0000000030a4', 'Price Test D'),
  ('00000000-0000-0000-0000-0000000030a5', 'Price Test E');
-- e1: LMS-made, RM 0                      → blanked
-- e2: LMS-made, RM 0, has a CRM payment   → kept
-- e3: CRM-made, RM 0, linked to the LMS   → kept
-- e4: CRM-made, RM 0, never in the LMS    → kept
-- e5: LMS-made, RM 1,200                  → kept
INSERT INTO enrolment (id, person_id, class_id, status, price_paid_myr, lms_enrollment_id) VALUES
  ('00000000-0000-0000-0000-0000000030e1', '00000000-0000-0000-0000-0000000030a1', '00000000-0000-0000-0000-0000000c3001', 'confirmed', 0, '00000000-0000-0000-0000-0000000030e1'),
  ('00000000-0000-0000-0000-0000000030e2', '00000000-0000-0000-0000-0000000030a2', '00000000-0000-0000-0000-0000000c3001', 'confirmed', 0, '00000000-0000-0000-0000-0000000030e2'),
  ('00000000-0000-0000-0000-0000000030e3', '00000000-0000-0000-0000-0000000030a3', '00000000-0000-0000-0000-0000000c3001', 'confirmed', 0, '00000000-0000-0000-0000-0000000030f3'),
  ('00000000-0000-0000-0000-0000000030e4', '00000000-0000-0000-0000-0000000030a4', '00000000-0000-0000-0000-0000000c3001', 'confirmed', 0, NULL),
  ('00000000-0000-0000-0000-0000000030e5', '00000000-0000-0000-0000-0000000030a5', '00000000-0000-0000-0000-0000000c3001', 'confirmed', 1200, '00000000-0000-0000-0000-0000000030e5');
INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no, proof_file_key, paid_at) VALUES
  ('00000000-0000-0000-0000-0000000030e2', 'bank_transfer', 'succeeded', 100, 'REF30', 'proofs/030.pdf', now());

UPDATE enrolment e SET price_paid_myr = NULL
WHERE e.price_paid_myr = 0
  AND e.lms_enrollment_id = e.id
  AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.enrolment_id = e.id);

SELECT pg_temp.check('an LMS-made RM 0 seat is blanked',
  (SELECT price_paid_myr IS NULL FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000030e1'));
SELECT pg_temp.check('an LMS-made seat with a CRM payment keeps RM 0',
  (SELECT price_paid_myr = 0 FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000030e2'));
SELECT pg_temp.check('a CRM-made seat linked to the LMS keeps RM 0',
  (SELECT price_paid_myr = 0 FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000030e3'));
SELECT pg_temp.check('a CRM-made seat never in the LMS keeps RM 0',
  (SELECT price_paid_myr = 0 FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000030e4'));
SELECT pg_temp.check('a real price is never touched',
  (SELECT price_paid_myr = 1200 FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000030e5'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
