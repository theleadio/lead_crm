-- Tests for migration 030. Run after 001-030. Rolled back.
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

INSERT INTO person (id, full_name) VALUES ('00000000-0000-0000-0000-0000000030a1', 'Source Test');

SELECT pg_temp.expect_ok('source: a touch without a source still inserts',
  $q$INSERT INTO touchpoint (person_id, channel, form_name)
     VALUES ('00000000-0000-0000-0000-0000000030a1', 'web_form', 'none')$q$);
SELECT pg_temp.check('source: empty by default',
  (SELECT source_type IS NULL AND entry_point IS NULL FROM touchpoint
   WHERE person_id = '00000000-0000-0000-0000-0000000030a1' AND form_name = 'none'));
SELECT pg_temp.expect_ok('source: a listed type and an entry point insert',
  $q$INSERT INTO touchpoint (person_id, channel, form_name, source_type, entry_point, external_ref)
     VALUES ('00000000-0000-0000-0000-0000000030a1', 'import', 'tag-backfill', 'event', 'masterclass 18 nov vibe coding en', 'tag-backfill:a1:t1')$q$);
SELECT pg_temp.expect_fail('source: an unlisted type is refused',
  $q$INSERT INTO touchpoint (person_id, channel, source_type)
     VALUES ('00000000-0000-0000-0000-0000000030a1', 'web_form', 'billboard')$q$,
  'touchpoint_source_type_check');
SELECT pg_temp.expect_fail('source: the same backfill key twice is refused',
  $q$INSERT INTO touchpoint (person_id, channel, source_type, entry_point, external_ref)
     VALUES ('00000000-0000-0000-0000-0000000030a1', 'import', 'event', 'x', 'tag-backfill:a1:t1')$q$,
  'touchpoint_external_ref_uq');
SELECT pg_temp.expect_fail('source: still append-only (a source cannot be edited in)',
  $q$UPDATE touchpoint SET source_type = 'email'
     WHERE person_id = '00000000-0000-0000-0000-0000000030a1' AND form_name = 'none'$q$,
  '');

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
