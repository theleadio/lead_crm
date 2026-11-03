-- Tests for migration 015. Run on an empty database after 001-015. Rolled back.
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

INSERT INTO person (id, full_name) VALUES ('00000000-0000-0000-0000-0000000015a1', 'Campaign Id Test');

SELECT pg_temp.expect_ok('touchpoint: a touch without the new ids still inserts',
  $q$INSERT INTO touchpoint (person_id, channel, form_name)
     VALUES ('00000000-0000-0000-0000-0000000015a1', 'web_form', 'none')$q$);
SELECT pg_temp.check('touchpoint: the new columns default to NULL',
  (SELECT utm_campaign_id IS NULL AND utm_ad_id IS NULL FROM touchpoint WHERE form_name = 'none'));
SELECT pg_temp.expect_ok('touchpoint: both ids are stored',
  $q$INSERT INTO touchpoint (person_id, channel, form_name, utm_campaign_id, utm_ad_id)
     VALUES ('00000000-0000-0000-0000-0000000015a1', 'import', 'both', '6878812432797', '120210000000001')$q$);
SELECT pg_temp.check('touchpoint: the stored values read back',
  (SELECT (utm_campaign_id, utm_ad_id) = ('6878812432797', '120210000000001') FROM touchpoint WHERE form_name = 'both'));
SELECT pg_temp.expect_fail('touchpoint: utm_campaign_id is append-only like every other column',
  $q$UPDATE touchpoint SET utm_campaign_id = 'x' WHERE form_name = 'both'$q$, 'append-only');
SELECT pg_temp.expect_fail('touchpoint: utm_ad_id is append-only like every other column',
  $q$UPDATE touchpoint SET utm_ad_id = 'x' WHERE form_name = 'both'$q$, 'append-only');
SELECT pg_temp.check('touchpoint: refused updates left the values alone',
  (SELECT utm_campaign_id = '6878812432797' AND utm_ad_id = '120210000000001' FROM touchpoint WHERE form_name = 'both'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
