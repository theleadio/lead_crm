-- Tests for migration 029. Run after 001-029. Rolled back.
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
  ('00000000-0000-0000-0000-00000000c029', 'C29', 'LMS Class Id Course', 'mastery', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c2901', '00000000-0000-0000-0000-00000000c029', 'M1', current_date + 30, current_date + 30, 'en', 'online', 'https://x', 30, 5, 'open'),
  ('00000000-0000-0000-0000-0000000c2902', '00000000-0000-0000-0000-00000000c029', 'M2', current_date + 31, current_date + 31, 'en', 'online', 'https://x', 30, 5, 'open'),
  ('00000000-0000-0000-0000-0000000c2903', '00000000-0000-0000-0000-00000000c029', 'M3', current_date + 32, current_date + 32, 'en', 'online', 'https://x', 30, 5, 'open');

SELECT pg_temp.check('lms class id: empty by default',
  (SELECT lms_cohort_id IS NULL FROM class WHERE id = '00000000-0000-0000-0000-0000000c2901'));
SELECT pg_temp.expect_ok('lms class id: can be set',
  $q$UPDATE class SET lms_cohort_id = '00000000-0000-0000-0000-0000000029f1' WHERE id = '00000000-0000-0000-0000-0000000c2901'$q$);
SELECT pg_temp.expect_fail('lms class id: one LMS cohort cannot belong to two CRM classes',
  $q$UPDATE class SET lms_cohort_id = '00000000-0000-0000-0000-0000000029f1' WHERE id = '00000000-0000-0000-0000-0000000c2902'$q$,
  'class_lms_cohort_id_uq');
SELECT pg_temp.check('lms class id: many classes may have none',
  (SELECT count(*) = 2 FROM class WHERE id IN ('00000000-0000-0000-0000-0000000c2902', '00000000-0000-0000-0000-0000000c2903') AND lms_cohort_id IS NULL));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
