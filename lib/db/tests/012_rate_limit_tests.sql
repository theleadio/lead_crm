-- Tests for migration 012. Run on an empty database after 001-012. Rolled back.
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
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

SELECT pg_temp.check('rate_limit_take: first hit returns 1', rate_limit_take('t:a', 60) = 1);
SELECT pg_temp.check('rate_limit_take: second hit returns 2', rate_limit_take('t:a', 60) = 2);
SELECT pg_temp.check('rate_limit_take: third hit returns 3', rate_limit_take('t:a', 60) = 3);
SELECT pg_temp.check('rate_limit_take: another bucket counts separately', rate_limit_take('t:b', 60) = 1);
SELECT pg_temp.check('rate_limit_take: another bucket with a longer window counts on its own',
  rate_limit_take('t:hour', 3600) = 1 AND rate_limit_take('t:hour', 3600) = 2);
SELECT pg_temp.check('rate_limit_take: one row per (bucket, window), hits summed',
  (SELECT count(*) = 1 AND max(hits) = 3 FROM rate_limit_hit
   WHERE bucket = 't:a' AND window_start = to_timestamp(floor(extract(epoch FROM now()) / 60) * 60)));

-- An old window starts again from 1 and rows over an hour old are swept.
INSERT INTO rate_limit_hit (bucket, window_start, hits)
VALUES ('t:old', now() - interval '2 hours', 9), ('t:a', now() - interval '3 minutes', 9);
SELECT pg_temp.check('rate_limit_take: a stale window does not carry over',
  rate_limit_take('t:a', 60) = 4);
SELECT pg_temp.check('rate_limit_take: rows older than an hour are deleted',
  NOT EXISTS (SELECT 1 FROM rate_limit_hit WHERE bucket = 't:old'));
SELECT pg_temp.check('rate_limit_take: a recent old window is kept',
  EXISTS (SELECT 1 FROM rate_limit_hit WHERE bucket = 't:a' AND hits = 9));

SELECT pg_temp.expect_fail('rate_limit_take: zero-second window is refused',
  $q$SELECT rate_limit_take('t:z', 0)$q$, 'window must be at least 1 second');
SELECT pg_temp.expect_fail('rate_limit_hit: a bucket needs a name',
  $q$INSERT INTO rate_limit_hit (bucket, window_start) VALUES (NULL, now())$q$, 'null value');
SELECT pg_temp.check('rate_limit_hit: table is unlogged',
  (SELECT relpersistence = 'u' FROM pg_class WHERE relname = 'rate_limit_hit'));
SELECT pg_temp.check('rate_limit_take: not executable by PUBLIC',
  NOT has_function_privilege('public', 'rate_limit_take(text, integer)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
