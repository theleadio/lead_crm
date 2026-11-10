-- Tests for migration 018. Run on an empty database after 001-018. Rolled back.
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

INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-000000017a0a', 'admin17@lead.test', 'Admin', 'super_admin');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-000000017a01', 'Resolution Test', 'res17@x.com'),
  ('00000000-0000-0000-0000-000000017a02', 'Bystander', 'by17@x.com');

SELECT pg_temp.check('enquiry.resolution is nullable text',
  (SELECT data_type = 'text' AND is_nullable = 'YES'
     FROM information_schema.columns
    WHERE table_name = 'enquiry' AND column_name = 'resolution'));

INSERT INTO enquiry (id, person_id, channel, summary) VALUES
  ('00000000-0000-0000-0000-000000017e01', '00000000-0000-0000-0000-000000017a01', 'whatsapp', 'Asked about HRDC'),
  ('00000000-0000-0000-0000-000000017e02', '00000000-0000-0000-0000-000000017a02', 'whatsapp', 'Asked about price');

SELECT pg_temp.check('a new enquiry has no resolution',
  (SELECT resolution IS NULL FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e01'));

UPDATE enquiry SET status = 'human_resolved', handled_by = 'user', closed_at = now(),
                   resolution = 'Sent the HRDC claim steps by WhatsApp'
 WHERE id IN ('00000000-0000-0000-0000-000000017e01', '00000000-0000-0000-0000-000000017e02');

SELECT pg_temp.check('closing keeps the summary and stores the note beside it',
  (SELECT summary = 'Asked about HRDC' AND resolution = 'Sent the HRDC claim steps by WhatsApp'
     FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e01'));
SELECT pg_temp.check('a change to resolution bumps the row version',
  (SELECT version = 2 FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e01'));

SELECT erase_person('00000000-0000-0000-0000-000000017a01', '00000000-0000-0000-0000-000000017a0a', 'PDPA request 17');

SELECT pg_temp.check('erase clears the summary and the resolution',
  (SELECT summary IS NULL AND resolution IS NULL
     FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e01'));
SELECT pg_temp.check('erase keeps the enquiry row, status and category',
  (SELECT status = 'human_resolved' AND person_id = '00000000-0000-0000-0000-000000017a01'
     FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e01'));
SELECT pg_temp.check('erase leaves another person''s enquiry alone',
  (SELECT summary = 'Asked about price' AND resolution = 'Sent the HRDC claim steps by WhatsApp'
     FROM enquiry WHERE id = '00000000-0000-0000-0000-000000017e02'));
SELECT pg_temp.check('erase audit row still holds no personal data',
  (SELECT before IS NULL AND after - 'merged_records_erased' = '{"reason":"PDPA request 17"}'::jsonb
     FROM audit_log WHERE action = 'erase' AND entity_id = '00000000-0000-0000-0000-000000017a01'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_test_nobody') THEN
    CREATE ROLE lead_test_nobody NOLOGIN;
  END IF;
END $$;
SELECT pg_temp.check('erase_person is still not callable by other roles',
  NOT has_function_privilege('lead_test_nobody', 'erase_person(uuid,uuid,text)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
