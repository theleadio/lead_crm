-- Tests for migration 005. Run after 001-005 on an empty database. Rolls itself back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

INSERT INTO person (id, full_name, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'A', 'a@x.com');
SELECT pg_temp.check('new row starts at version 1',
  (SELECT version = 1 FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));

UPDATE person SET full_name = 'A2' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.check('an update adds exactly 1',
  (SELECT version = 2 FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));

UPDATE person SET full_name = 'A2' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.check('an update that changes nothing still bumps',
  (SELECT version = 3 FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));

UPDATE person SET version = 999 WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.check('the app cannot choose the version',
  (SELECT version = 4 FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));

-- Two writes in ONE transaction: updated_at (now()) cannot tell them apart, version can.
UPDATE person SET full_name = 'A3' WHERE id = '00000000-0000-0000-0000-0000000000a1';
CREATE TEMP TABLE snap AS SELECT version, updated_at FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1';
UPDATE person SET full_name = 'A4' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.check('same transaction: updated_at is identical, version still differs',
  (SELECT p.updated_at = s.updated_at AND p.version = s.version + 1
   FROM person p, snap s WHERE p.id = '00000000-0000-0000-0000-0000000000a1'));

-- The PATCH pattern: WHERE id AND version = $expected
CREATE TEMP TABLE r (n int);
WITH u AS (UPDATE person SET full_name = 'first' WHERE id = '00000000-0000-0000-0000-0000000000a1' AND version = 6 RETURNING 1)
INSERT INTO r SELECT count(*) FROM u;
WITH u AS (UPDATE person SET full_name = 'second' WHERE id = '00000000-0000-0000-0000-0000000000a1' AND version = 6 RETURNING 1)
INSERT INTO r SELECT count(*) FROM u;
SELECT pg_temp.check('first PATCH with version 6 wins, second with the stale 6 matches 0 rows',
  (SELECT array_agg(n ORDER BY ctid) = ARRAY[1,0] FROM r)
  AND (SELECT full_name = 'first' FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));

-- Coverage: every PATCH-able table has the column and the trigger
SELECT pg_temp.check('15 tables have version + trigger',
  (SELECT count(*) = 15 FROM information_schema.columns WHERE column_name = 'version' AND table_schema = 'public')
  AND (SELECT count(*) = 15 FROM pg_trigger WHERE tgname LIKE '%\_bump\_version' AND NOT tgisinternal));
SELECT pg_temp.check('system-written tables are left alone',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'version' AND table_schema = 'public'
              AND table_name IN ('message_log','event_outbox','integration_event')));

-- Merge still works and bumps the survivor
INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@lead.test', 'Admin', 'super_admin');
INSERT INTO person (id, full_name, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 'B', 'b@x.com');
CREATE TEMP TABLE before AS SELECT version FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT merge_person('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.check('merge bumps the survivor so open edit forms conflict',
  (SELECT p.version > b.version FROM person p, before b WHERE p.id = '00000000-0000-0000-0000-0000000000a1'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
