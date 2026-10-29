-- Tests for migration 013. Run on an empty database after 001-013. Rolled back.
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

INSERT INTO person (id, full_name) VALUES ('00000000-0000-0000-0000-0000000013a1', 'Click Test');

SELECT pg_temp.expect_ok('touchpoint: a touch without click ids still inserts',
  $q$INSERT INTO touchpoint (person_id, channel, form_name)
     VALUES ('00000000-0000-0000-0000-0000000013a1', 'web_form', 'none')$q$);
SELECT pg_temp.check('touchpoint: the new columns default to NULL',
  (SELECT gbraid IS NULL AND wbraid IS NULL AND li_fat_id IS NULL AND ttclid IS NULL
     FROM touchpoint WHERE form_name = 'none'));
SELECT pg_temp.expect_ok('touchpoint: all four click ids are stored',
  $q$INSERT INTO touchpoint (person_id, channel, form_name, gbraid, wbraid, li_fat_id, ttclid)
     VALUES ('00000000-0000-0000-0000-0000000013a1', 'web_form', 'all', 'gb1', 'wb1', 'li1', 'tt1')$q$);
SELECT pg_temp.check('touchpoint: the stored values read back',
  (SELECT (gbraid, wbraid, li_fat_id, ttclid) = ('gb1', 'wb1', 'li1', 'tt1')
     FROM touchpoint WHERE form_name = 'all'));
SELECT pg_temp.expect_fail('touchpoint: gbraid is append-only like every other column',
  $q$UPDATE touchpoint SET gbraid = 'x' WHERE form_name = 'all'$q$, 'append-only');
SELECT pg_temp.expect_fail('touchpoint: ttclid is append-only like every other column',
  $q$UPDATE touchpoint SET ttclid = 'x' WHERE form_name = 'all'$q$, 'append-only');
SELECT pg_temp.check('touchpoint: refused updates left the values alone',
  (SELECT gbraid = 'gb1' AND ttclid = 'tt1' FROM touchpoint WHERE form_name = 'all'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
