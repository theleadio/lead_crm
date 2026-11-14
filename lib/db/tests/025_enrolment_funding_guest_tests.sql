-- Tests for migration 025. Run after 001-025 (023 included). Rolled back.
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
  ('00000000-0000-0000-0000-00000000c025', 'C25', 'Guest Funding Course', 'mastery', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c2501', '00000000-0000-0000-0000-00000000c025', 'G1', current_date + 30, current_date + 30, 'en', 'online', 'https://x', 30, 5, 'open');
INSERT INTO person (id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000025a1', 'Guest Funding Test');
INSERT INTO enrolment (id, person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-0000000025e1', '00000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000c2501', 'confirmed');

SELECT pg_temp.expect_ok('funding: guest is accepted',
  $q$UPDATE enrolment SET funding_type = 'guest' WHERE id = '00000000-0000-0000-0000-0000000025e1'$q$);
SELECT pg_temp.check('funding: guest is stored',
  (SELECT funding_type = 'guest' FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000025e1'));
SELECT pg_temp.expect_ok('funding: the five earlier LMS values are still accepted',
  $q$DO $d$ DECLARE v text; BEGIN
       FOREACH v IN ARRAY ARRAY['self_funded','hrdc','internal','leaders_club','refresher'] LOOP
         UPDATE enrolment SET funding_type = v WHERE id = '00000000-0000-0000-0000-0000000025e1';
       END LOOP;
     END $d$$q$);
SELECT pg_temp.expect_ok('funding: empty is still allowed',
  $q$UPDATE enrolment SET funding_type = NULL WHERE id = '00000000-0000-0000-0000-0000000025e1'$q$);
SELECT pg_temp.expect_fail('funding: a value outside the list is still refused',
  $q$UPDATE enrolment SET funding_type = 'company' WHERE id = '00000000-0000-0000-0000-0000000025e1'$q$, 'enrolment_funding_type_check');
SELECT pg_temp.check('funding: enrolment has exactly one CHECK on funding_type',
  (SELECT count(*) = 1 FROM pg_constraint
    WHERE conrelid = 'enrolment'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%funding_type%'));
SELECT pg_temp.check('funding: that CHECK keeps the 023 name',
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'enrolment'::regclass AND conname = 'enrolment_funding_type_check'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
