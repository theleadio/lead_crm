-- Tests for 026 (backfill last_login_at). Runs the same UPDATE as 026 on its
-- own rows, twice. Rolled back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;
-- The 026 statement, word for word.
CREATE FUNCTION pg_temp.backfill() RETURNS void LANGUAGE sql AS $$
  UPDATE app_user u
  SET last_login_at = s.last_sign_in
  FROM (SELECT user_id, max(at) AS last_sign_in
        FROM audit_log
        WHERE action = 'sign_in' AND user_id IS NOT NULL
        GROUP BY user_id) s
  WHERE s.user_id = u.id AND u.last_login_at IS NULL;
$$;

INSERT INTO app_user (id, email, full_name, role_code, last_login_at) VALUES
  ('00000000-0000-0000-0000-0000000026a1', '026-two@lead.test',   '026 Two sign-ins', 'sales', NULL),
  ('00000000-0000-0000-0000-0000000026a2', '026-none@lead.test',  '026 Never',        'sales', NULL),
  ('00000000-0000-0000-0000-0000000026a3', '026-set@lead.test',   '026 Already set',  'sales', '2026-11-10 09:00+08'),
  ('00000000-0000-0000-0000-0000000026a4', '026-failed@lead.test','026 Only failed',  'sales', NULL);
INSERT INTO audit_log (user_id, action, entity, at) VALUES
  ('00000000-0000-0000-0000-0000000026a1', 'sign_in',        'app_user', '2026-11-01 09:00+08'),
  ('00000000-0000-0000-0000-0000000026a1', 'sign_in',        'app_user', '2026-11-13 09:00+08'),
  ('00000000-0000-0000-0000-0000000026a1', 'sign_in_failed', 'app_user', '2026-11-14 09:00+08'),
  ('00000000-0000-0000-0000-0000000026a3', 'sign_in',        'app_user', '2026-11-12 09:00+08'),
  ('00000000-0000-0000-0000-0000000026a4', 'sign_in_failed', 'app_user', '2026-11-12 09:00+08');

SELECT pg_temp.backfill();
SELECT pg_temp.check('backfill: two sign-ins give the later time',
  (SELECT last_login_at = '2026-11-13 09:00+08' FROM app_user WHERE id = '00000000-0000-0000-0000-0000000026a1'));
SELECT pg_temp.check('backfill: no sign_in row stays empty',
  (SELECT last_login_at IS NULL FROM app_user WHERE id = '00000000-0000-0000-0000-0000000026a2'));
SELECT pg_temp.check('backfill: a value already set is kept',
  (SELECT last_login_at = '2026-11-10 09:00+08' FROM app_user WHERE id = '00000000-0000-0000-0000-0000000026a3'));
SELECT pg_temp.check('backfill: a sign_in_failed row is ignored',
  (SELECT last_login_at IS NULL FROM app_user WHERE id = '00000000-0000-0000-0000-0000000026a4'));

CREATE TEMP TABLE first_run AS SELECT id, last_login_at FROM app_user;
SELECT pg_temp.backfill();
SELECT pg_temp.check('backfill: a second run changes nothing',
  NOT EXISTS (SELECT 1 FROM app_user u JOIN first_run f USING (id)
              WHERE u.last_login_at IS DISTINCT FROM f.last_login_at));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
