-- Tests for migration 011. Run on an empty database after 001-011. Rolled back.
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

SELECT pg_temp.expect_ok('task: source_key defaults to NULL',
  $q$INSERT INTO task (type, title) VALUES ('other', 'a')$q$);
SELECT pg_temp.check('task: source_key is NULL on a normal task',
  (SELECT source_key IS NULL FROM task WHERE title = 'a'));
SELECT pg_temp.expect_ok('task: many tasks without a key are fine',
  $q$INSERT INTO task (type, title) VALUES ('other', 'b'), ('other', 'c')$q$);
SELECT pg_temp.expect_ok('task: a keyed task is accepted',
  $q$INSERT INTO task (type, title, source_key) VALUES ('other', 'k1', 'ev1:tell:e1')$q$);
SELECT pg_temp.expect_fail('task: the same key twice is refused',
  $q$INSERT INTO task (type, title, source_key) VALUES ('other', 'k2', 'ev1:tell:e1')$q$,
  'task_source_key_uq');
SELECT pg_temp.expect_ok('task: ON CONFLICT DO NOTHING makes the repeat a no-op',
  $q$INSERT INTO task (type, title, source_key) VALUES ('other', 'k3', 'ev1:tell:e1') ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING$q$);
SELECT pg_temp.check('task: still exactly one task with that key',
  (SELECT count(*) = 1 FROM task WHERE source_key = 'ev1:tell:e1'));
UPDATE task SET done_at = now() WHERE source_key = 'ev1:tell:e1';
SELECT pg_temp.expect_fail('task: the key stays unique after the task is done',
  $q$INSERT INTO task (type, title, source_key) VALUES ('other', 'k4', 'ev1:tell:e1')$q$,
  'task_source_key_uq');
SELECT pg_temp.expect_ok('task: a different key is accepted',
  $q$INSERT INTO task (type, title, source_key) VALUES ('other', 'k5', 'ev1:tell:e2')$q$);

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
