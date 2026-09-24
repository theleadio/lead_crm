-- Tests for migration 003. Run on an empty database after 001, 002 and 003.
-- Calls that write are run as their own statement before the check reads the
-- result: a single statement reads from a snapshot taken before its own call.
-- Wrapped in a transaction and rolled back.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, false);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name, true); END;
END $$;
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

-- Normalisation
SELECT pg_temp.check('Sdn. Bhd. / SDN BHD / (M) / Berhad all normalise the same',
  (SELECT count(DISTINCT normalise_company_name(t)) = 1 FROM unnest(ARRAY[
     'Acme Sdn. Bhd.', 'ACME SDN BHD', 'Acme (M) Sdn Bhd', ' acme sdn bhd ', 'Acme Berhad', 'Acme (Malaysia) Sdn. Bhd.']) t));
SELECT pg_temp.check('a different company stays different',
  normalise_company_name('Acme Holdings Sdn Bhd') <> normalise_company_name('Acme Sdn Bhd'));
SELECT pg_temp.check('suffix-only and blank input give NULL',
  normalise_company_name('Sdn. Bhd.') IS NULL AND normalise_company_name('   ') IS NULL AND normalise_company_name(NULL) IS NULL);
SELECT pg_temp.check('placeholders give NULL',
  normalise_company_name('N/A') IS NULL AND normalise_company_name('Self-employed') IS NULL
  AND normalise_company_name('Student') IS NULL AND normalise_company_name('none') IS NULL);
SELECT pg_temp.check('Chinese names kept; 有限公司 removed',
  normalise_company_name('莱德科技有限公司') = '莱德科技');
SELECT pg_temp.check('bhd inside a word is kept',
  normalise_company_name('Bhdcorp Sdn Bhd') = 'bhdcorp');

-- Fixtures
INSERT INTO company (id, legal_name) VALUES
  ('00000000-0000-0000-0000-0000000c0001', 'Acme (M) Sdn. Bhd.'),
  ('00000000-0000-0000-0000-0000000c0002', 'Twin Corp Sdn Bhd'),
  ('00000000-0000-0000-0000-0000000c0003', 'TWIN CORP BERHAD'),
  ('00000000-0000-0000-0000-0000000c0004', 'Gone Sdn Bhd');
UPDATE company SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-0000000c0004';
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Person A', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'Person B', 'b@x.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'Person C', 'c@x.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'Person D', 'd@x.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'Person E', 'e@x.com'),
  ('00000000-0000-0000-0000-0000000000f1', 'Person F', 'f@x.com');

SELECT pg_temp.check('company.name_norm is generated',
  (SELECT name_norm = 'acme' FROM company WHERE id = '00000000-0000-0000-0000-0000000c0001'));
SELECT pg_temp.expect_fail('name_norm cannot be written by the app',
  $q$UPDATE company SET name_norm = 'x' WHERE id = '00000000-0000-0000-0000-0000000c0001'$q$);

-- One match: linked
SELECT pg_temp.check('one match: returns the company',
  link_company_from_form('00000000-0000-0000-0000-0000000000a1', 'ACME SDN BHD') = '00000000-0000-0000-0000-0000000c0001');
SELECT pg_temp.check('one match: current membership created, no flags',
  (SELECT count(*) = 1 AND bool_and(NOT is_hr_contact AND NOT is_billing_contact AND end_date IS NULL)
   FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.check('typed text stored as given',
  (SELECT company_name_given = 'ACME SDN BHD' FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));
CREATE TEMP TABLE r (id uuid);
INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000a1', 'Acme');
SELECT pg_temp.check('same form again: no second membership',
  (SELECT id IS NULL FROM r) AND (SELECT count(*) FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000a1') = 1);

-- Already at another company: text stored, membership untouched
INSERT INTO company_membership (person_id, company_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000c0002');
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000b1', 'Acme Sdn Bhd');
SELECT pg_temp.check('already at a company: no new link', (SELECT id IS NULL FROM r));
SELECT pg_temp.check('already at a company: existing membership unchanged',
  (SELECT count(*) = 1 AND bool_and(company_id = '00000000-0000-0000-0000-0000000c0002')
   FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000b1'));
SELECT pg_temp.check('already at a company: text still stored',
  (SELECT company_name_given = 'Acme Sdn Bhd' FROM person WHERE id = '00000000-0000-0000-0000-0000000000b1'));

-- Two matches, no match, deleted company, placeholder, blank
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000c1', 'Twin Corp');
SELECT pg_temp.check('two matching companies: no link',
  (SELECT id IS NULL FROM r) AND NOT EXISTS (SELECT 1 FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000c1'));
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000d1', 'Brand New Sdn Bhd');
SELECT pg_temp.check('no match: no link and no company created',
  (SELECT id IS NULL FROM r) AND (SELECT count(*) FROM company) = 4
  AND (SELECT company_name_given = 'Brand New Sdn Bhd' FROM person WHERE id = '00000000-0000-0000-0000-0000000000d1'));
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000e1', 'Gone Sdn Bhd');
SELECT pg_temp.check('deleted company is never matched',
  (SELECT id IS NULL FROM r) AND NOT EXISTS (SELECT 1 FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000e1'));
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000f1', 'N/A');
SELECT pg_temp.check('placeholder answer: stored, not linked',
  (SELECT id IS NULL FROM r) AND NOT EXISTS (SELECT 1 FROM company_membership WHERE person_id = '00000000-0000-0000-0000-0000000000f1')
  AND (SELECT company_name_given = 'N/A' FROM person WHERE id = '00000000-0000-0000-0000-0000000000f1'));
TRUNCATE r; INSERT INTO r SELECT link_company_from_form('00000000-0000-0000-0000-0000000000f1', '   ');
SELECT pg_temp.check('blank input leaves the stored text alone',
  (SELECT id IS NULL FROM r) AND (SELECT company_name_given = 'N/A' FROM person WHERE id = '00000000-0000-0000-0000-0000000000f1'));
SELECT link_company_from_form('00000000-0000-0000-0000-0000000000f1', repeat('x', 300));
SELECT pg_temp.check('long text cut to 200 characters', (SELECT char_length(company_name_given) = 200 FROM person WHERE id = '00000000-0000-0000-0000-0000000000f1'));

-- Guards
SELECT pg_temp.expect_fail('unknown person rejected',
  $q$SELECT link_company_from_form('00000000-0000-0000-0000-00000000ffff', 'Acme')$q$);
UPDATE person SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_fail('deleted person rejected',
  $q$SELECT link_company_from_form('00000000-0000-0000-0000-0000000000e1', 'Acme')$q$);

-- Erasure clears the typed company name
INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@lead.test', 'Admin', 'super_admin');
SELECT erase_person('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'PDPA request');
SELECT pg_temp.check('erase clears company_name_given',
  (SELECT company_name_given IS NULL AND full_name = 'Erased person' FROM person
   WHERE id = '00000000-0000-0000-0000-0000000000d1'));

-- Privileges
CREATE ROLE lead_test_nobody3 NOLOGIN;
SELECT pg_temp.check('link_company_from_form not callable by other roles',
  NOT has_function_privilege('lead_test_nobody3', 'link_company_from_form(uuid,text)', 'EXECUTE'));
SELECT pg_temp.check('erase_person still not callable by other roles',
  NOT has_function_privilege('lead_test_nobody3', 'erase_person(uuid,uuid,text)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
