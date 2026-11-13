-- Tests for migration 019. Run on an empty database after 001-019. Rolled back.
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
  ('00000000-0000-0000-0000-000000019a0a', 'admin19@lead.test', 'Admin', 'super_admin');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-000000019a01', 'Ticket Test', 't19@x.com'),
  ('00000000-0000-0000-0000-000000019a02', 'Duplicate', 'd19@x.com'),
  ('00000000-0000-0000-0000-000000019a03', 'Bystander', 'b19@x.com');

-- Seeds
SELECT pg_temp.check('five teams, Support is the one default',
  (SELECT count(*) = 5 AND count(*) FILTER (WHERE is_default AND code = 'support') = 1 FROM team));
SELECT pg_temp.check('only Finance is restricted',
  (SELECT array_agg(code) = ARRAY['finance'] FROM team WHERE restricted));
SELECT pg_temp.check('the ten §5 categories are kept, plus four support ones',
  (SELECT count(*) = 14 FROM enquiry_category
    WHERE code IN ('course_info','schedule','price','hrdc','corporate','registration_help',
                   'payment_issue','post_class','complaint','other',
                   'einvoice','receipt','voucher','api_key')));
SELECT pg_temp.expect_fail('a second default team is refused',
  $$INSERT INTO team (code, name, is_default) VALUES ('two', 'Two', true)$$, 'team_one_default');

-- enquiry columns and the team trigger
INSERT INTO enquiry (id, person_id, channel) VALUES
  ('00000000-0000-0000-0000-000000019e01', '00000000-0000-0000-0000-000000019a01', 'whatsapp');
INSERT INTO enquiry (id, person_id, channel, category) VALUES
  ('00000000-0000-0000-0000-000000019e02', '00000000-0000-0000-0000-000000019a01', 'web_form', 'receipt');

SELECT pg_temp.check('an uncategorised enquiry goes to the default team',
  (SELECT t.code = 'support' FROM enquiry e JOIN team t ON t.id = e.team_id
    WHERE e.id = '00000000-0000-0000-0000-000000019e01'));
SELECT pg_temp.check('a categorised enquiry goes to the category''s team',
  (SELECT t.code = 'finance' FROM enquiry e JOIN team t ON t.id = e.team_id
    WHERE e.id = '00000000-0000-0000-0000-000000019e02'));
SELECT pg_temp.check('enquiries get distinct E- numbers',
  (SELECT count(DISTINCT number) = 2 AND bool_and(number ~ '^E-\d{6}$') FROM enquiry
    WHERE id IN ('00000000-0000-0000-0000-000000019e01', '00000000-0000-0000-0000-000000019e02')));
SELECT pg_temp.check('priority defaults to normal',
  (SELECT priority = 'normal' FROM enquiry WHERE id = '00000000-0000-0000-0000-000000019e01'));
SELECT pg_temp.expect_ok('waiting_customer is a status',
  $$UPDATE enquiry SET status = 'waiting_customer' WHERE id = '00000000-0000-0000-0000-000000019e01'$$);
SELECT pg_temp.expect_fail('an unknown status is refused',
  $$UPDATE enquiry SET status = 'new' WHERE id = '00000000-0000-0000-0000-000000019e01'$$, 'enquiry_status_check');
SELECT pg_temp.expect_fail('an unknown category is refused',
  $$UPDATE enquiry SET category = 'nope' WHERE id = '00000000-0000-0000-0000-000000019e01'$$, 'enquiry_category_fkey');
SELECT pg_temp.expect_fail('an empty subject is refused',
  $$UPDATE enquiry SET subject = '' WHERE id = '00000000-0000-0000-0000-000000019e01'$$, 'enquiry_subject_check');
SELECT pg_temp.expect_fail('an unknown priority is refused',
  $$UPDATE enquiry SET priority = 'urgent' WHERE id = '00000000-0000-0000-0000-000000019e01'$$, 'enquiry_priority_check');
SELECT pg_temp.expect_fail('converted still needs a deal',
  $$UPDATE enquiry SET status = 'converted' WHERE id = '00000000-0000-0000-0000-000000019e01'$$, 'enquiry_check');
SELECT pg_temp.expect_fail('a rule must match something',
  $$INSERT INTO enquiry_rule (position) VALUES (1)$$, 'enquiry_rule_check');

-- enquiry_event: append-only, except clearing a note
INSERT INTO enquiry_event (id, enquiry_id, user_id, kind, note) VALUES
  ('00000000-0000-0000-0000-000000019f01', '00000000-0000-0000-0000-000000019e01',
   '00000000-0000-0000-0000-000000019a0a', 'note', 'Called back, left a message');
SELECT pg_temp.expect_fail('an event cannot be deleted',
  $$DELETE FROM enquiry_event WHERE id = '00000000-0000-0000-0000-000000019f01'$$, 'append-only');
SELECT pg_temp.expect_fail('an event''s note cannot be rewritten',
  $$UPDATE enquiry_event SET note = 'Something else' WHERE id = '00000000-0000-0000-0000-000000019f01'$$, 'append-only');
SELECT pg_temp.expect_fail('an event''s kind cannot change, even while clearing its note',
  $$UPDATE enquiry_event SET note = NULL, kind = 'status' WHERE id = '00000000-0000-0000-0000-000000019f01'$$, 'append-only');

-- Conversations, merge and erase
INSERT INTO conversation (id, person_id, channel, external_thread_id) VALUES
  ('00000000-0000-0000-0000-000000019c01', '00000000-0000-0000-0000-000000019a02', 'web_form', 'thread-19-a'),
  ('00000000-0000-0000-0000-000000019c03', '00000000-0000-0000-0000-000000019a03', 'web_form', 'thread-19-b');
INSERT INTO conversation_message (conversation_id, person_id, channel, direction, external_message_id, body, attachment_paths) VALUES
  ('00000000-0000-0000-0000-000000019c01', '00000000-0000-0000-0000-000000019a02', 'web_form', 'in', 'm19a', 'My receipt is wrong', ARRAY['help/x.pdf']),
  ('00000000-0000-0000-0000-000000019c03', '00000000-0000-0000-0000-000000019a03', 'web_form', 'in', 'm19b', 'Unrelated', '{}');
SELECT pg_temp.expect_fail('a message id is unique per channel',
  $$INSERT INTO conversation_message (conversation_id, person_id, channel, direction, external_message_id)
    VALUES ('00000000-0000-0000-0000-000000019c01', '00000000-0000-0000-0000-000000019a02', 'web_form', 'in', 'm19a')$$,
  'conversation_message_channel_external_message_id_key');

SELECT merge_person('00000000-0000-0000-0000-000000019a02', '00000000-0000-0000-0000-000000019a01',
                    '00000000-0000-0000-0000-000000019a0a');
SELECT pg_temp.check('merge moves the conversation and its messages',
  (SELECT count(*) = 1 FROM conversation
    WHERE id = '00000000-0000-0000-0000-000000019c01' AND person_id = '00000000-0000-0000-0000-000000019a01')
  AND (SELECT count(*) = 1 FROM conversation_message
    WHERE external_message_id = 'm19a' AND person_id = '00000000-0000-0000-0000-000000019a01'));

UPDATE enquiry SET subject = 'Receipt shows the wrong company'
 WHERE id = '00000000-0000-0000-0000-000000019e02';
SELECT erase_person('00000000-0000-0000-0000-000000019a01', '00000000-0000-0000-0000-000000019a0a', 'PDPA request 19');

SELECT pg_temp.check('erase clears message text and attachment paths',
  (SELECT bool_and(body IS NULL AND attachment_paths = '{}') FROM conversation_message
    WHERE person_id = '00000000-0000-0000-0000-000000019a01'));
SELECT pg_temp.check('erase clears the enquiry subject',
  (SELECT subject IS NULL FROM enquiry WHERE id = '00000000-0000-0000-0000-000000019e02'));
SELECT pg_temp.check('erase clears notes but keeps the event',
  (SELECT note IS NULL AND kind = 'note' FROM enquiry_event WHERE id = '00000000-0000-0000-0000-000000019f01'));
SELECT pg_temp.check('erase leaves another person''s messages alone',
  (SELECT body = 'Unrelated' FROM conversation_message WHERE external_message_id = 'm19b'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_test_nobody') THEN
    CREATE ROLE lead_test_nobody NOLOGIN;
  END IF;
END $$;
SELECT pg_temp.check('merge_person and erase_person stay closed to other roles',
  NOT has_function_privilege('lead_test_nobody', 'erase_person(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('lead_test_nobody', 'merge_person(uuid,uuid,uuid)', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
