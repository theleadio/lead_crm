-- Tests for 027 (LEADER Club system tag). Runs the same statement as 027 on its
-- own tag names, then checks the real tag once 027 has run. Rolled back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;
-- The 027 statement, word for word, with the name as a parameter.
CREATE FUNCTION pg_temp.seed(tag_name text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO tag (name, is_system) VALUES (tag_name, true)
  ON CONFLICT ((lower(name))) DO UPDATE SET is_system = true, is_active = true;
$$;

SELECT pg_temp.seed('027 New Club');
SELECT pg_temp.check('seed: a new tag is a system tag',
  (SELECT is_system AND is_active FROM tag WHERE name = '027 New Club'));

INSERT INTO tag (name, is_system, is_active) VALUES ('027 old club', false, false);
CREATE TEMP TABLE before AS SELECT id FROM tag WHERE name = '027 old club';
SELECT pg_temp.seed('027 OLD CLUB');
SELECT pg_temp.check('seed: an existing user tag (any case) is promoted and reactivated',
  (SELECT is_system AND is_active FROM tag WHERE lower(name) = '027 old club'));
SELECT pg_temp.check('seed: the existing tag keeps its id and name',
  (SELECT id = (SELECT id FROM before) AND name = '027 old club'
   FROM tag WHERE lower(name) = '027 old club'));

SELECT pg_temp.seed('027 New Club');
SELECT pg_temp.check('seed: a second run makes no second row',
  (SELECT count(*) = 1 FROM tag WHERE lower(name) = '027 new club'));

SELECT pg_temp.check('027 applied: LEADER Club is an active system tag',
  (SELECT is_system AND is_active FROM tag WHERE lower(name) = 'leader club'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
