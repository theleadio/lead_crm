-- Tests for migration 017. Run on an empty database after 001-017. Rolled back.
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

INSERT INTO person (full_name) VALUES ('Deal Owner 017');

SELECT pg_temp.expect_ok('deal: external_ref defaults to NULL',
  $q$INSERT INTO deal (pipeline, stage, person_id) SELECT 'individual', 'new', id FROM person WHERE full_name = 'Deal Owner 017'$q$);
SELECT pg_temp.expect_ok('deal: many deals without a ref are fine',
  $q$INSERT INTO deal (pipeline, stage, person_id) SELECT 'individual', 'new', id FROM person WHERE full_name = 'Deal Owner 017'$q$);
SELECT pg_temp.expect_ok('deal: a deal with a ref is accepted',
  $q$INSERT INTO deal (pipeline, stage, person_id, external_ref) SELECT 'individual', 'new', id, 'ghl-opp:1' FROM person WHERE full_name = 'Deal Owner 017'$q$);
SELECT pg_temp.expect_fail('deal: the same ref twice is refused',
  $q$INSERT INTO deal (pipeline, stage, person_id, external_ref) SELECT 'individual', 'new', id, 'ghl-opp:1' FROM person WHERE full_name = 'Deal Owner 017'$q$,
  'deal_external_ref_uq');
SELECT pg_temp.check('deal: imported_unknown exists and is inactive',
  (SELECT NOT is_active FROM lost_reason WHERE code = 'imported_unknown'));
SELECT pg_temp.expect_ok('deal: a lost deal with imported_unknown is accepted',
  $q$INSERT INTO deal (pipeline, stage, person_id, lost_at, lost_reason_id) SELECT 'individual', 'lost', p.id, now(), r.id FROM person p, lost_reason r WHERE p.full_name = 'Deal Owner 017' AND r.code = 'imported_unknown'$q$);

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
