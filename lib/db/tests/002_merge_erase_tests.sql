-- Tests for migration 002. Run on an empty database after 001 and 002.
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
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;

-- Fixtures: A (source) and B (target)
INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000000000a','admin@lead.test','Admin','super_admin');
INSERT INTO person (id, full_name, email, phone_e164, last_activity_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1','Tan Mei Ling','a@x.com','+60111111111','2026-09-01'),
  ('00000000-0000-0000-0000-0000000000b1','Tan Meiling','b@x.com','+60122222222','2026-09-20'),
  ('00000000-0000-0000-0000-0000000000c1','Other Person','c@x.com',NULL,NULL);
INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c0c0','AIA','AI Agentic Automation','certification',2);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity) VALUES
  ('00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c0c0','AIA-2610-EN','2026-10-06','2026-10-07','en','online','https://z',30),
  ('00000000-0000-0000-0000-00000000d002','00000000-0000-0000-0000-00000000c0c0','AIA-2611-EN','2026-11-06','2026-11-07','en','online','https://z',30);
-- A's touchpoint is earlier than B's; both marked first touch.
INSERT INTO touchpoint (id, person_id, channel, occurred_at, is_first_touch, utm_campaign) VALUES
  ('00000000-0000-0000-0000-00000000f0a1','00000000-0000-0000-0000-0000000000a1','web_form','2026-08-01',true,'yt_organic'),
  ('00000000-0000-0000-0000-00000000f0b1','00000000-0000-0000-0000-0000000000b1','whatsapp','2026-09-10',true,'meta_ctwa');
-- A opted out of WhatsApp; B's grant is more recent.
INSERT INTO consent (person_id, purpose, is_granted, recorded_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1','marketing_whatsapp',false,'2026-08-05'),
  ('00000000-0000-0000-0000-0000000000b1','marketing_whatsapp',true,'2026-09-15'),
  ('00000000-0000-0000-0000-0000000000b1','marketing_email',true,'2026-09-15');
INSERT INTO tag (id, name) VALUES ('00000000-0000-0000-0000-0000000007a9','VIP');
INSERT INTO person_tag (person_id, tag_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000007a9'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000007a9');
INSERT INTO enrolment (id, person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-00000000e0a1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000d001','confirmed'),
  ('00000000-0000-0000-0000-00000000e0b1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000d001','confirmed');
INSERT INTO task (id, type, title, person_id, related_person_id) VALUES
  ('00000000-0000-0000-0000-000000007a51','review_duplicate','Possible duplicate','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');

-- needs_review_reason
SELECT pg_temp.expect_fail('needs_review without a reason rejected',
  $q$UPDATE person SET needs_review = true WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
SELECT pg_temp.expect_fail('reason without needs_review rejected',
  $q$UPDATE person SET needs_review_reason = 'no_name' WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
SELECT pg_temp.expect_fail('unknown reason rejected',
  $q$UPDATE person SET needs_review = true, needs_review_reason = 'vibes' WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);

-- Append-only still holds outside a merge
SELECT pg_temp.expect_fail('touchpoint re-point blocked outside merge',
  $q$UPDATE touchpoint SET person_id='00000000-0000-0000-0000-0000000000c1' WHERE id='00000000-0000-0000-0000-00000000f0a1'$q$);
SELECT pg_temp.expect_fail('even with the flag, other touchpoint columns stay frozen',
  $q$SELECT set_config('lead.merge_in_progress','on',true);
     UPDATE touchpoint SET utm_campaign='hacked' WHERE id='00000000-0000-0000-0000-00000000f0a1'$q$);
SELECT set_config('lead.merge_in_progress','off',true);
SELECT pg_temp.expect_fail('even with the flag, audit_log stays frozen',
  $q$INSERT INTO audit_log (id, action) VALUES ('00000000-0000-0000-0000-0000000a0d17','x');
     SELECT set_config('lead.merge_in_progress','on',true);
     UPDATE audit_log SET action='y' WHERE id='00000000-0000-0000-0000-0000000a0d17'$q$);
SELECT set_config('lead.merge_in_progress','off',true);
SELECT pg_temp.expect_fail('touchpoint delete still blocked with the flag',
  $q$SELECT set_config('lead.merge_in_progress','on',true);
     DELETE FROM touchpoint WHERE id='00000000-0000-0000-0000-00000000f0a1'$q$);
SELECT set_config('lead.merge_in_progress','off',true);

-- Merge guards
SELECT pg_temp.expect_fail('merge blocked when both are in the same class',
  $q$SELECT merge_person('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a')$q$);
SELECT pg_temp.expect_fail('merge into self rejected',
  $q$SELECT merge_person('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a')$q$);
SELECT pg_temp.expect_fail('merge without actor rejected',
  $q$SELECT merge_person('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',NULL)$q$);

-- Resolve the clash, then merge A into B
UPDATE enrolment SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000e0a1';
SELECT merge_person('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a');

SELECT pg_temp.check('A is marked merged into B',
  (SELECT merged_into_id FROM person WHERE id='00000000-0000-0000-0000-0000000000a1')='00000000-0000-0000-0000-0000000000b1');
SELECT pg_temp.check('all touchpoints now belong to B',
  (SELECT count(*) FROM touchpoint WHERE person_id='00000000-0000-0000-0000-0000000000b1')=2);
SELECT pg_temp.check('earliest touchpoint (A''s) is the only first touch',
  (SELECT array_agg(id) FROM touchpoint WHERE person_id='00000000-0000-0000-0000-0000000000b1' AND is_first_touch)
   = ARRAY['00000000-0000-0000-0000-00000000f0a1'::uuid]);
SELECT pg_temp.check('B''s first_touchpoint_id points at it',
  (SELECT first_touchpoint_id FROM person WHERE id='00000000-0000-0000-0000-0000000000b1')='00000000-0000-0000-0000-00000000f0a1');
SELECT pg_temp.check('touchpoint campaign data unchanged by the move',
  (SELECT utm_campaign FROM touchpoint WHERE id='00000000-0000-0000-0000-00000000f0a1')='yt_organic');
SELECT pg_temp.check('A''s WhatsApp opt-out wins over B''s later grant',
  (SELECT NOT is_granted FROM consent_current WHERE person_id='00000000-0000-0000-0000-0000000000b1' AND purpose='marketing_whatsapp'));
SELECT pg_temp.check('B''s email consent untouched',
  (SELECT is_granted FROM consent_current WHERE person_id='00000000-0000-0000-0000-0000000000b1' AND purpose='marketing_email'));
SELECT pg_temp.check('all consent rows moved to B',
  (SELECT count(*) FROM consent WHERE person_id='00000000-0000-0000-0000-0000000000a1')=0);
SELECT pg_temp.check('shared tag kept once',
  (SELECT count(*) FROM person_tag WHERE tag_id='00000000-0000-0000-0000-0000000007a9')=1);
SELECT pg_temp.check('cancelled enrolment moved to B',
  (SELECT person_id FROM enrolment WHERE id='00000000-0000-0000-0000-00000000e0a1')='00000000-0000-0000-0000-0000000000b1');
SELECT pg_temp.check('duplicate-review task closed',
  (SELECT done_at IS NOT NULL FROM task WHERE id='00000000-0000-0000-0000-000000007a51'));
SELECT pg_temp.check('B keeps the latest last_activity_at',
  (SELECT last_activity_at FROM person WHERE id='00000000-0000-0000-0000-0000000000b1')='2026-09-20');
SELECT pg_temp.check('merge written to audit log',
  (SELECT count(*) FROM audit_log WHERE action='merge')=1);
SELECT pg_temp.check('flag is off again after the merge',
  coalesce(current_setting('lead.merge_in_progress', true),'off') = 'off');
SELECT pg_temp.expect_ok('A''s email can now be copied onto B (fields map)',
  $q$UPDATE person SET email='a@x.com' WHERE id='00000000-0000-0000-0000-0000000000b1'$q$);
SELECT pg_temp.expect_fail('cannot merge an already-merged person',
  $q$SELECT merge_person('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a')$q$);

-- Soft delete
SELECT pg_temp.expect_fail('soft delete refused for someone with enrolments',
  $q$SELECT soft_delete_person('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a','test')$q$);
SELECT pg_temp.expect_fail('soft delete needs a reason',
  $q$SELECT soft_delete_person('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','  ')$q$);
SELECT soft_delete_person('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','test record');
SELECT pg_temp.check('soft delete audit row holds no personal data',
  (SELECT before IS NULL FROM audit_log WHERE action = 'soft_delete'
   AND entity_id = '00000000-0000-0000-0000-0000000000c1'));
SELECT pg_temp.check('soft delete sets deleted_at',
  (SELECT deleted_at IS NOT NULL FROM person WHERE id='00000000-0000-0000-0000-0000000000c1'));

-- Erasure
INSERT INTO message_log (person_id, channel, direction, body) VALUES
  ('00000000-0000-0000-0000-0000000000b1','whatsapp','in','My IC is 900101-01-1234');
SELECT erase_person('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a','PDPA request 2026-09-24');
SELECT pg_temp.check('erase clears name, email, phone',
  (SELECT full_name='Erased person' AND email IS NULL AND email_norm IS NULL AND phone_e164 IS NULL AND erased_at IS NOT NULL
   FROM person WHERE id='00000000-0000-0000-0000-0000000000b1'));
SELECT pg_temp.check('erase clears message bodies',
  (SELECT count(*) FROM message_log WHERE person_id='00000000-0000-0000-0000-0000000000b1' AND body IS NOT NULL)=0);
SELECT pg_temp.check('erase keeps enrolments',
  (SELECT count(*) FROM enrolment WHERE person_id='00000000-0000-0000-0000-0000000000b1')=2);
SELECT pg_temp.check('erase keeps touchpoints and consent',
  (SELECT count(*) FROM touchpoint WHERE person_id='00000000-0000-0000-0000-0000000000b1')=2
  AND (SELECT count(*) FROM consent WHERE person_id='00000000-0000-0000-0000-0000000000b1')>0);
SELECT pg_temp.check('erase audit row holds no personal data',
  (SELECT before IS NULL AND after - 'merged_records_erased' = '{"reason":"PDPA request 2026-09-24"}'::jsonb FROM audit_log WHERE action='erase'));
SELECT pg_temp.check('erase also anonymises the record merged into them',
  (SELECT full_name = 'Erased person' AND email IS NULL AND phone_e164 IS NULL AND erased_at IS NOT NULL
   FROM person WHERE id = '00000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.check('erase audit counts the merged record',
  (SELECT (after->>'merged_records_erased')::int = 1 FROM audit_log
   WHERE action = 'erase' AND entity_id = '00000000-0000-0000-0000-0000000000b1'));
SELECT pg_temp.expect_fail('cannot erase twice',
  $q$SELECT erase_person('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a','again')$q$);
SELECT pg_temp.expect_ok('erased person''s old email is free for a new signup',
  $q$INSERT INTO person (full_name, email) VALUES ('New signup','a@x.com')$q$);

-- Privileges: a role with no grants cannot call the functions
CREATE ROLE lead_test_nobody NOLOGIN;
SELECT pg_temp.check('merge_person not callable by other roles',
  NOT has_function_privilege('lead_test_nobody', 'merge_person(uuid,uuid,uuid)', 'EXECUTE'));
SELECT pg_temp.check('erase_person not callable by other roles',
  NOT has_function_privilege('lead_test_nobody', 'erase_person(uuid,uuid,text)', 'EXECUTE'));
SELECT pg_temp.check('soft_delete_person not callable by other roles',
  NOT has_function_privilege('lead_test_nobody', 'soft_delete_person(uuid,uuid,text)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
