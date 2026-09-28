-- Tests for migration 004. Run on an empty database after 001–004.
-- Wrapped in a transaction and rolled back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, false);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name, true); END;
END $$;
CREATE FUNCTION pg_temp.expect_ok(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, true);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name || ' [' || SQLERRM || ']', false); END;
END $$;

INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@lead.test', 'Admin', 'super_admin');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Person A', 'a@x.com');
INSERT INTO deal (id, pipeline, stage, person_id) VALUES
  ('00000000-0000-0000-0000-00000000de01', 'corporate', 'new', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000de02', 'corporate', 'new', '00000000-0000-0000-0000-0000000000a1');

SELECT pg_temp.expect_ok('first open hrdc_deadline task allowed',
  $q$INSERT INTO task (id, type, title, deal_id) VALUES
     ('00000000-0000-0000-0000-0000000007a1', 'hrdc_deadline', 'HRDC deadline', '00000000-0000-0000-0000-00000000de01')$q$);
SELECT pg_temp.expect_fail('second open hrdc_deadline task on the same deal rejected',
  $q$INSERT INTO task (type, title, deal_id) VALUES ('hrdc_deadline', 'HRDC deadline again', '00000000-0000-0000-0000-00000000de01')$q$);
SELECT pg_temp.expect_ok('open hrdc_deadline task on a different deal allowed',
  $q$INSERT INTO task (type, title, deal_id) VALUES ('hrdc_deadline', 'HRDC deadline', '00000000-0000-0000-0000-00000000de02')$q$);
SELECT pg_temp.expect_ok('other task types on the same deal unaffected',
  $q$INSERT INTO task (type, title, deal_id) VALUES ('follow_up', 'Call', '00000000-0000-0000-0000-00000000de01'),
                                                  ('follow_up', 'Call again', '00000000-0000-0000-0000-00000000de01')$q$);
SELECT pg_temp.expect_ok('closing the open task',
  $q$UPDATE task SET done_at = now(), done_by = '00000000-0000-0000-0000-00000000000a'
     WHERE id = '00000000-0000-0000-0000-0000000007a1'$q$);
SELECT pg_temp.expect_ok('new open task allowed once the old one is done',
  $q$INSERT INTO task (type, title, deal_id) VALUES ('hrdc_deadline', 'HRDC deadline (new date)', '00000000-0000-0000-0000-00000000de01')$q$);
SELECT pg_temp.expect_fail('reopening the old task while a new one is open rejected',
  $q$UPDATE task SET done_at = NULL, done_by = NULL WHERE id = '00000000-0000-0000-0000-0000000007a1'$q$);
SELECT pg_temp.expect_fail('hrdc_deadline task without a deal rejected',
  $q$INSERT INTO task (type, title) VALUES ('hrdc_deadline', 'No deal')$q$);

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
