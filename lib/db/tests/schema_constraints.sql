-- Constraint tests for schema v1. Run on an empty database after migrations/001_schema_v1.sql.
-- Every block raises if the schema does NOT behave as the spec requires.
-- Wrapped in a transaction and rolled back, so it leaves no data behind.
BEGIN;

CREATE TEMP TABLE results (name text, ok boolean);

CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results VALUES (test_name, false);
  EXCEPTION WHEN others THEN
    INSERT INTO results VALUES (test_name, true);
  END;
END $$;

CREATE FUNCTION pg_temp.expect_ok(test_name text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results VALUES (test_name, true);
  EXCEPTION WHEN others THEN
    RAISE NOTICE '% failed: %', test_name, SQLERRM;
    INSERT INTO results VALUES (test_name, false);
  END;
END $$;

-- Fixtures
INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'shawn@lead.test', 'Shawn', 'super_admin');
INSERT INTO person (id, full_name, email, phone_e164) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Tan Mei Ling', ' MeiLing@Example.com ', '+60123456789');
INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'AIA', 'AI Agentic Automation', 'certification', 2);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, venue_name, venue_address, city, capacity) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'AIA-2610-EN',
   '2026-10-06', '2026-10-07', 'en', 'in_person', 'AI365 Hub', 'Oval Damansara', 'Kuala Lumpur', 30);

-- People / dedupe
SELECT pg_temp.expect_ok  ('email_norm is generated lowercase+trimmed',
  $q$DO $d$ BEGIN IF (SELECT email_norm FROM person WHERE id='00000000-0000-0000-0000-000000000001') <> 'meiling@example.com' THEN RAISE EXCEPTION 'bad'; END IF; END $d$$q$);
SELECT pg_temp.expect_fail('duplicate email (different case) rejected',
  $q$INSERT INTO person (full_name, email) VALUES ('Someone', 'MEILING@example.com')$q$);
SELECT pg_temp.expect_fail('duplicate phone rejected',
  $q$INSERT INTO person (full_name, phone_e164) VALUES ('Someone', '+60123456789')$q$);
SELECT pg_temp.expect_fail('un-normalised phone rejected',
  $q$INSERT INTO person (full_name, phone_e164) VALUES ('Someone', '012-345 6789')$q$);
SELECT pg_temp.expect_ok  ('deleted person frees its email for reuse',
  $q$INSERT INTO person (full_name, email, deleted_at) VALUES ('Old', 'reuse@x.com', now());
     INSERT INTO person (full_name, email) VALUES ('New', 'reuse@x.com')$q$);
SELECT pg_temp.expect_fail('empty name rejected',
  $q$INSERT INTO person (full_name) VALUES ('   ')$q$);

-- Touchpoints are append-only, one first touch per person
SELECT pg_temp.expect_ok  ('touchpoint insert',
  $q$INSERT INTO touchpoint (id, person_id, channel, is_first_touch) VALUES
     ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001','web_form', true)$q$);
SELECT pg_temp.expect_fail('touchpoint update blocked',
  $q$UPDATE touchpoint SET utm_source='x' WHERE id='00000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_fail('touchpoint delete blocked',
  $q$DELETE FROM touchpoint WHERE id='00000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_fail('second first-touch rejected',
  $q$INSERT INTO touchpoint (person_id, channel, is_first_touch) VALUES ('00000000-0000-0000-0000-000000000001','whatsapp', true)$q$);

-- Classes
SELECT pg_temp.expect_fail('end before start rejected',
  $q$INSERT INTO class (course_id, code, start_date, end_date, language, mode, online_url, capacity)
     VALUES ('00000000-0000-0000-0000-0000000000c1','X1','2026-10-07','2026-10-06','en','online','https://z',10)$q$);
SELECT pg_temp.expect_fail('in-person class without venue rejected',
  $q$INSERT INTO class (course_id, code, start_date, end_date, language, mode, capacity)
     VALUES ('00000000-0000-0000-0000-0000000000c1','X2','2026-10-06','2026-10-06','en','in_person',10)$q$);
SELECT pg_temp.expect_fail('online class without URL rejected',
  $q$INSERT INTO class (course_id, code, start_date, end_date, language, mode, capacity)
     VALUES ('00000000-0000-0000-0000-0000000000c1','X3','2026-10-06','2026-10-06','zh','online',10)$q$);
SELECT pg_temp.expect_fail('language other than en/zh rejected',
  $q$INSERT INTO class (course_id, code, start_date, end_date, language, mode, online_url, capacity)
     VALUES ('00000000-0000-0000-0000-0000000000c1','X4','2026-10-06','2026-10-06','English','online','https://z',10)$q$);

-- Enrolments: no double-booking, but re-booking after cancel is fine
SELECT pg_temp.expect_ok  ('first enrolment',
  $q$INSERT INTO enrolment (id, person_id, class_id) VALUES
     ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1')$q$);
SELECT pg_temp.expect_fail('double-booking rejected',
  $q$INSERT INTO enrolment (person_id, class_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1')$q$);
SELECT pg_temp.expect_ok  ('re-book after cancelling',
  $q$UPDATE enrolment SET status='cancelled' WHERE id='00000000-0000-0000-0000-0000000000e1';
     INSERT INTO enrolment (person_id, class_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1')$q$);
SELECT pg_temp.expect_fail('transferred without target rejected',
  $q$UPDATE enrolment SET status='transferred' WHERE id='00000000-0000-0000-0000-0000000000e1'$q$);

-- Deals: stage must fit pipeline; lost needs a reason
SELECT pg_temp.expect_fail('corporate stage on individual deal rejected',
  $q$INSERT INTO deal (pipeline, stage, person_id) VALUES ('individual','proposal_sent','00000000-0000-0000-0000-000000000001')$q$);
SELECT pg_temp.expect_fail('lost without reason rejected',
  $q$INSERT INTO deal (pipeline, stage, person_id, lost_at) VALUES ('individual','lost','00000000-0000-0000-0000-000000000001', now())$q$);
SELECT pg_temp.expect_ok  ('lost with reason accepted',
  $q$INSERT INTO deal (pipeline, stage, person_id, lost_at, lost_reason_id)
     SELECT 'individual','lost','00000000-0000-0000-0000-000000000001', now(), id FROM lost_reason WHERE code='price'$q$);
SELECT pg_temp.expect_fail('corporate deal past discovery without company/headcount/funding rejected',
  $q$INSERT INTO deal (pipeline, stage, person_id) VALUES ('corporate','proposal_sent','00000000-0000-0000-0000-000000000001')$q$);
SELECT pg_temp.expect_fail('stage history is append-only',
  $q$INSERT INTO deal_stage_history (id, deal_id, to_stage) SELECT '00000000-0000-0000-0000-0000000000b1', id, 'lost' FROM deal LIMIT 1;
     UPDATE deal_stage_history SET to_stage='won' WHERE id='00000000-0000-0000-0000-0000000000b1'$q$);

-- Payments
SELECT pg_temp.expect_fail('matched payment with no links rejected',
  $q$INSERT INTO payment (method, status, amount_myr) VALUES ('stripe_card','succeeded', 3200)$q$);
SELECT pg_temp.expect_ok  ('unmatched Stripe payment with no links accepted',
  $q$INSERT INTO payment (method, status, amount_myr, match_status, stripe_payment_intent_id) VALUES ('stripe_card','succeeded', 3200, 'unmatched', 'pi_1')$q$);
SELECT pg_temp.expect_fail('same Stripe intent twice rejected (webhook replay)',
  $q$INSERT INTO payment (method, status, amount_myr, match_status, stripe_payment_intent_id) VALUES ('stripe_card','succeeded', 3200, 'unmatched', 'pi_1')$q$);
SELECT pg_temp.expect_fail('unmatched bank transfer rejected',
  $q$INSERT INTO payment (method, status, amount_myr, match_status, reference_no, proof_file_key) VALUES ('bank_transfer','succeeded', 3200, 'unmatched','r','k')$q$);
SELECT pg_temp.expect_fail('manual payment without proof rejected',
  $q$INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no) VALUES ('00000000-0000-0000-0000-0000000000e1','bank_transfer','succeeded', 3200, 'REF1')$q$);
SELECT pg_temp.expect_fail('refund larger than payment rejected',
  $q$INSERT INTO payment (enrolment_id, method, status, amount_myr, refunded_amount_myr) VALUES ('00000000-0000-0000-0000-0000000000e1','stripe_card','refunded', 100, 150)$q$);
SELECT pg_temp.expect_fail('non-MYR currency rejected',
  $q$INSERT INTO payment (enrolment_id, method, status, amount_myr, currency) VALUES ('00000000-0000-0000-0000-0000000000e1','stripe_card','succeeded', 100, 'USD')$q$);

-- Class notices: one pending per class
SELECT pg_temp.expect_ok  ('first pending notice',
  $q$INSERT INTO class_notice (class_id, changed_fields) VALUES ('00000000-0000-0000-0000-0000000000d1', '{"start_date":{"from":"2026-10-06","to":"2026-10-13"}}')$q$);
SELECT pg_temp.expect_fail('second pending notice for same class rejected',
  $q$INSERT INTO class_notice (class_id, changed_fields) VALUES ('00000000-0000-0000-0000-0000000000d1', '{}')$q$);
SELECT pg_temp.expect_fail('approved notice without approver rejected',
  $q$INSERT INTO class_notice (class_id, changed_fields, status) VALUES ('00000000-0000-0000-0000-0000000000d1', '{}', 'approved')$q$);

-- Tasks
SELECT pg_temp.expect_fail('merge proposal needs two different people',
  $q$INSERT INTO task (type, title, person_id, related_person_id) VALUES ('review_duplicate','x','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')$q$);

-- Tags, audit, consent
SELECT pg_temp.expect_fail('tag names unique case-insensitively',
  $q$INSERT INTO tag (name) VALUES ('VIP'); INSERT INTO tag (name) VALUES ('vip')$q$);
SELECT pg_temp.expect_fail('audit log is append-only',
  $q$INSERT INTO audit_log (id, action) VALUES ('00000000-0000-0000-0000-0000000000a9','test');
     DELETE FROM audit_log WHERE id='00000000-0000-0000-0000-0000000000a9'$q$);
SELECT pg_temp.expect_ok  ('consent_current returns the latest decision',
  $q$INSERT INTO consent (person_id, purpose, is_granted, recorded_at) VALUES
       ('00000000-0000-0000-0000-000000000001','marketing_whatsapp', true,  now() - interval '1 day'),
       ('00000000-0000-0000-0000-000000000001','marketing_whatsapp', false, now());
     DO $d$ BEGIN IF (SELECT is_granted FROM consent_current WHERE purpose='marketing_whatsapp') THEN RAISE EXCEPTION 'stale'; END IF; END $d$$q$);

-- updated_at trigger
SELECT pg_temp.expect_ok  ('updated_at moves on update',
  $q$UPDATE person SET updated_at = '2000-01-01' WHERE id='00000000-0000-0000-0000-000000000001';
     UPDATE person SET notes='x' WHERE id='00000000-0000-0000-0000-000000000001';
     DO $d$ BEGIN IF (SELECT updated_at < now() - interval '1 minute' FROM person WHERE id='00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'not bumped'; END IF; END $d$$q$);

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;

ROLLBACK;
