-- Tests for migration 023. Run on an empty database after 001-023. Rolled back.
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

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c023', 'C23', 'Campaign Link Course', 'mastery', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c2301', '00000000-0000-0000-0000-00000000c023', 'L1', current_date + 30, current_date + 30, 'en', 'online', 'https://x', 30, 5, 'open'),
  ('00000000-0000-0000-0000-0000000c2302', '00000000-0000-0000-0000-00000000c023', 'L2', current_date + 40, current_date + 40, 'en', 'online', 'https://x', 30, 5, 'open');
INSERT INTO person (id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000023a1', 'Funding Test');

-- class_meta_campaign
SELECT pg_temp.expect_ok('link: a class takes a campaign',
  $q$INSERT INTO class_meta_campaign (class_id, meta_campaign_id, campaign_name)
     VALUES ('00000000-0000-0000-0000-0000000c2301', '120210000000001', 'LEAD | Nov2026 | Sales | L1')$q$);
SELECT pg_temp.expect_ok('link: the same class takes a second campaign',
  $q$INSERT INTO class_meta_campaign (class_id, meta_campaign_id)
     VALUES ('00000000-0000-0000-0000-0000000c2301', '120210000000002')$q$);
SELECT pg_temp.expect_fail('link: one campaign cannot sell two classes',
  $q$INSERT INTO class_meta_campaign (class_id, meta_campaign_id)
     VALUES ('00000000-0000-0000-0000-0000000c2302', '120210000000001')$q$, 'class_meta_campaign_one_class');
SELECT pg_temp.expect_fail('link: the campaign id must be Meta''s numeric id, not a name',
  $q$INSERT INTO class_meta_campaign (class_id, meta_campaign_id)
     VALUES ('00000000-0000-0000-0000-0000000c2302', 'Vibe Coding Masterclass EN 19 Nov')$q$, 'meta_campaign_id_check');
SELECT pg_temp.expect_fail('link: the class must exist',
  $q$INSERT INTO class_meta_campaign (class_id, meta_campaign_id)
     VALUES ('00000000-0000-0000-0000-0000000c23ff', '120210000000003')$q$, 'foreign key');
SELECT pg_temp.check('link: the class has both campaigns',
  (SELECT count(*) = 2 FROM class_meta_campaign WHERE class_id = '00000000-0000-0000-0000-0000000c2301'));

-- enrolment.funding_type
SELECT pg_temp.check('funding: enrolment.funding_type is nullable text',
  (SELECT data_type = 'text' AND is_nullable = 'YES'
     FROM information_schema.columns
    WHERE table_name = 'enrolment' AND column_name = 'funding_type'));
SELECT pg_temp.expect_ok('funding: a seat without funding still inserts',
  $q$INSERT INTO enrolment (id, person_id, class_id, status)
     VALUES ('00000000-0000-0000-0000-0000000023e1', '00000000-0000-0000-0000-0000000023a1', '00000000-0000-0000-0000-0000000c2301', 'confirmed')$q$);
SELECT pg_temp.check('funding: it defaults to NULL',
  (SELECT funding_type IS NULL FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000023e1'));
SELECT pg_temp.expect_ok('funding: every LMS value is accepted',
  $q$DO $d$ DECLARE v text; BEGIN
       FOREACH v IN ARRAY ARRAY['self_funded','hrdc','internal','leaders_club','refresher'] LOOP
         UPDATE enrolment SET funding_type = v WHERE id = '00000000-0000-0000-0000-0000000023e1';
       END LOOP;
     END $d$$q$);
SELECT pg_temp.expect_ok('funding: leaders_club is stored',
  $q$UPDATE enrolment SET funding_type = 'leaders_club' WHERE id = '00000000-0000-0000-0000-0000000023e1'$q$);
SELECT pg_temp.expect_fail('funding: a deal-style value is refused',
  $q$UPDATE enrolment SET funding_type = 'company' WHERE id = '00000000-0000-0000-0000-0000000023e1'$q$, 'enrolment_funding_type_check');
SELECT pg_temp.check('funding: the refused update left the value alone',
  (SELECT funding_type = 'leaders_club' FROM enrolment WHERE id = '00000000-0000-0000-0000-0000000023e1'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
