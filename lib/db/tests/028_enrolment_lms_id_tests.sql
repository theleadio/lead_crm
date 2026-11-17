-- Tests for migration 028. Run after 001-028. Rolled back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text, expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name || ' [no error]', false);
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%' || expect || '%' THEN INSERT INTO results VALUES (test_name, true);
    ELSE INSERT INTO results VALUES (test_name || ' [wrong error: ' || SQLERRM || ']', false); END IF;
  END;
END $$;
CREATE FUNCTION pg_temp.expect_ok(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, true);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name || ' [' || SQLERRM || ']', false); END;
END $$;
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c028', 'C28', 'LMS Id Course', 'mastery', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c2801', '00000000-0000-0000-0000-00000000c028', 'L1', current_date + 30, current_date + 30, 'en', 'online', 'https://x', 30, 5, 'open');
INSERT INTO person (id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000028a1', 'LMS Id Test A'),
  ('00000000-0000-0000-0000-0000000028a2', 'LMS Id Test B'),
  ('00000000-0000-0000-0000-0000000028a3', 'LMS Id Test C');
INSERT INTO enrolment (id, person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-0000000028e1', '00000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000c2801', 'confirmed'),
  ('00000000-0000-0000-0000-0000000028e2', '00000000-0000-0000-0000-0000000028a2', '00000000-0000-0000-0000-0000000c2801', 'confirmed'),
  ('00000000-0000-0000-0000-0000000028e3', '00000000-0000-0000-0000-0000000028a3', '00000000-0000-0000-0000-0000000c2801', 'confirmed');

SELECT pg_temp.check('lms id: empty by default',
  (SELECT lms_enrollment_id IS NULL FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000028e1'));
SELECT pg_temp.expect_ok('lms id: can be set',
  $q$UPDATE enrolment SET lms_enrollment_id = '00000000-0000-0000-0000-0000000028f1' WHERE id = '00000000-0000-0000-0000-0000000028e1'$q$);
SELECT pg_temp.expect_fail('lms id: one LMS seat cannot belong to two CRM seats',
  $q$UPDATE enrolment SET lms_enrollment_id = '00000000-0000-0000-0000-0000000028f1' WHERE id = '00000000-0000-0000-0000-0000000028e2'$q$,
  'enrolment_lms_enrollment_id_uq');
SELECT pg_temp.check('lms id: many seats may have none',
  (SELECT count(*) = 2 FROM enrolment WHERE id IN ('00000000-0000-0000-0000-0000000028e2', '00000000-0000-0000-0000-0000000028e3') AND lms_enrollment_id IS NULL));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
