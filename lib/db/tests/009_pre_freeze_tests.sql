-- Tests for migration 009. Run on an empty database after 001-009 (also runs on a
-- seeded one: fixture ids and keys don't collide). Wrapped in a transaction and rolled back.
-- expect_fail names the constraint/message it expects, so a row refused for some
-- other reason counts as a failure, not a pass.
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

-- Fixtures
INSERT INTO app_user (id, email, full_name, role_code) VALUES
  ('00000000-0000-0000-0000-00000006000a', 'admin006@lead.test', 'Admin', 'super_admin');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000600a1', 'Person A', 'a006@x.test'),
  ('00000000-0000-0000-0000-0000000600b1', 'Person B', 'b006@x.test');
INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000006c0c0', 'T006', 'Test course', 'workshop', 1);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity) VALUES
  ('00000000-0000-0000-0000-00000006d001', '00000000-0000-0000-0000-00000006c0c0', 'T006-1', '2026-11-01', '2026-11-01', 'en', 'online', 'https://z', 10),
  ('00000000-0000-0000-0000-00000006d002', '00000000-0000-0000-0000-00000006c0c0', 'T006-2', '2026-11-08', '2026-11-08', 'en', 'online', 'https://z', 10);
INSERT INTO deal (id, pipeline, stage, person_id) VALUES
  ('00000000-0000-0000-0000-00000006de01', 'individual', 'new', '00000000-0000-0000-0000-0000000600a1');
INSERT INTO enrolment (id, person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-00000006e0a1', '00000000-0000-0000-0000-0000000600a1', '00000000-0000-0000-0000-00000006d001', 'confirmed');
-- Unmatched Stripe payments for the match_payment tasks.
INSERT INTO payment (id, method, status, amount_myr, match_status, stripe_payment_intent_id, paid_at) VALUES
  ('00000000-0000-0000-0000-000000069a01', 'stripe_card', 'succeeded', 100, 'unmatched', 'pi_006_1', now()),
  ('00000000-0000-0000-0000-000000069a02', 'stripe_card', 'succeeded', 100, 'unmatched', 'pi_006_2', now()),
  ('00000000-0000-0000-0000-000000069a03', 'stripe_card', 'succeeded', 100, 'unmatched', 'pi_006_3', now());

-- S-11: a worker (NULL actor) can close a task
SELECT pg_temp.expect_ok('task closed with done_by NULL accepted (worker)',
  $q$INSERT INTO task (type, title, done_at) VALUES ('other', 'closed by a worker', now())$q$);
SELECT pg_temp.expect_fail('done_by without done_at rejected',
  $q$INSERT INTO task (type, title, done_by) VALUES ('other', 'x', '00000000-0000-0000-0000-00000006000a')$q$,
  'task_done_by_needs_done_at');
SELECT pg_temp.check('001''s done_at = done_by pairing CHECK is gone',
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'task'::regclass
              AND pg_get_constraintdef(oid) LIKE '%(done_at IS NULL) = (done_by IS NULL)%'));

-- S-01: match_payment task -> payment, one open per payment
SELECT pg_temp.expect_fail('match_payment task without payment_id rejected',
  $q$INSERT INTO task (type, title) VALUES ('match_payment', 'Match me')$q$,
  'task_match_payment_needs_payment');
SELECT pg_temp.expect_ok('first open match_payment task accepted',
  $q$INSERT INTO task (id, type, title, payment_id) VALUES
     ('00000000-0000-0000-0000-00000006a001', 'match_payment', 'Match me', '00000000-0000-0000-0000-000000069a01')$q$);
SELECT pg_temp.expect_fail('second open match_payment task for the same payment rejected',
  $q$INSERT INTO task (type, title, payment_id) VALUES ('match_payment', 'Again', '00000000-0000-0000-0000-000000069a01')$q$,
  'task_match_payment_open_uq');
SELECT pg_temp.expect_ok('after the first is done (by a worker), a new one is accepted',
  $q$UPDATE task SET done_at = now() WHERE id = '00000000-0000-0000-0000-00000006a001';
     INSERT INTO task (type, title, payment_id) VALUES ('match_payment', 'Again', '00000000-0000-0000-0000-000000069a01')$q$);
SELECT pg_temp.expect_fail('task.payment_id must be a real payment',
  $q$INSERT INTO task (type, title, payment_id) VALUES ('match_payment', 'x', '00000000-0000-0000-0000-0000000fffff')$q$,
  'task_payment_id_fkey');

-- S-10: withdrawn = closed + flagged
SELECT pg_temp.expect_fail('is_cancelled on an open task rejected',
  $q$INSERT INTO task (type, title, is_cancelled) VALUES ('other', 'x', true)$q$,
  'task_cancelled_is_closed');
SELECT pg_temp.expect_ok('is_cancelled on a closed task accepted',
  $q$INSERT INTO task (type, title, is_cancelled, done_at) VALUES ('other', 'withdrawn', true, now())$q$);
SELECT pg_temp.check('is_cancelled defaults to false',
  (SELECT NOT is_cancelled FROM task WHERE id = '00000000-0000-0000-0000-00000006a001'));

-- S-03: payment status, paid_at and refunds agree
SELECT pg_temp.expect_fail('succeeded without paid_at rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr) VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'succeeded', 100)$q$,
  'payment_paid_at_when_paid');
SELECT pg_temp.expect_ok('pending without paid_at accepted',
  $q$INSERT INTO payment (id, deal_id, method, status, amount_myr) VALUES
     ('00000000-0000-0000-0000-000000069b01', '00000000-0000-0000-0000-00000006de01', 'stripe_card', 'pending', 100)$q$);
SELECT pg_temp.expect_fail('refunded with less than the full amount rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at, refunded_amount_myr, refunded_at)
     VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'refunded', 100, now(), 40, now())$q$,
  'payment_refund_matches_status');
SELECT pg_temp.expect_fail('partially_refunded with 0 refunded rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at) VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'partially_refunded', 100, now())$q$,
  'payment_refund_matches_status');
SELECT pg_temp.expect_fail('partially_refunded with the full amount rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at, refunded_amount_myr, refunded_at)
     VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'partially_refunded', 100, now(), 100, now())$q$,
  'payment_refund_matches_status');
SELECT pg_temp.expect_fail('succeeded with a refund amount rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at, refunded_amount_myr, refunded_at)
     VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'succeeded', 100, now(), 10, now())$q$,
  'payment_refund_matches_status');
SELECT pg_temp.expect_fail('refund without refunded_at rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at, refunded_amount_myr)
     VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'refunded', 100, now(), 100)$q$,
  'payment_refunded_at_when_refunded');
SELECT pg_temp.expect_fail('refunded_at without a refund rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, paid_at, refunded_at)
     VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'succeeded', 100, now(), now())$q$,
  'payment_refunded_at_when_refunded');
SELECT pg_temp.expect_ok('consistent succeeded / partially_refunded / refunded / failed rows accepted',
  $q$INSERT INTO payment (id, deal_id, method, status, amount_myr, paid_at, refunded_amount_myr, refunded_at, stripe_checkout_session_id) VALUES
     ('00000000-0000-0000-0000-000000069c01', '00000000-0000-0000-0000-00000006de01', 'stripe_card', 'succeeded',          300, now(), 0,   NULL,  'cs_006_1'),
     ('00000000-0000-0000-0000-000000069c02', '00000000-0000-0000-0000-00000006de01', 'stripe_card', 'partially_refunded', 200, now(), 50,  now(), NULL),
     ('00000000-0000-0000-0000-000000069c03', '00000000-0000-0000-0000-00000006de01', 'stripe_card', 'refunded',           150, now(), 150, now(), NULL),
     ('00000000-0000-0000-0000-000000069c04', '00000000-0000-0000-0000-00000006de01', 'stripe_card', 'failed',             999, NULL,  0,   NULL,  NULL)$q$);
SELECT pg_temp.expect_fail('same checkout session id twice rejected',
  $q$INSERT INTO payment (deal_id, method, status, amount_myr, stripe_checkout_session_id) VALUES ('00000000-0000-0000-0000-00000006de01', 'stripe_card', 'pending', 100, 'cs_006_1')$q$,
  'payment_stripe_session_uq');
SELECT pg_temp.check('payment_net: net amounts, and pending/failed excluded',
  (SELECT array_agg(net_myr ORDER BY id) FROM payment_net WHERE deal_id = '00000000-0000-0000-0000-00000006de01')
  = ARRAY[300, 150, 0]::numeric[]);
SELECT pg_temp.check('payment_net: unmatched succeeded payments count as received',
  (SELECT count(*) FROM payment_net WHERE id IN ('00000000-0000-0000-0000-000000069a01','00000000-0000-0000-0000-000000069b01')) = 1);

-- S-04: enrolment status history is append-only
SELECT pg_temp.expect_ok('history rows can be inserted',
  $q$INSERT INTO enrolment_status_history (id, enrolment_id, from_status, to_status, changed_by) VALUES
     ('00000000-0000-0000-0000-00000006f001', '00000000-0000-0000-0000-00000006e0a1', NULL, 'reserved', '00000000-0000-0000-0000-00000006000a'),
     ('00000000-0000-0000-0000-00000006f002', '00000000-0000-0000-0000-00000006e0a1', 'reserved', 'confirmed', NULL)$q$);
SELECT pg_temp.expect_fail('history UPDATE refused',
  $q$UPDATE enrolment_status_history SET to_status = 'cancelled' WHERE id = '00000000-0000-0000-0000-00000006f001'$q$,
  'append-only');
SELECT pg_temp.expect_fail('history DELETE refused',
  $q$DELETE FROM enrolment_status_history WHERE id = '00000000-0000-0000-0000-00000006f001'$q$,
  'append-only');
SELECT pg_temp.expect_fail('history UPDATE refused even with the merge flag on',
  $q$SELECT set_config('lead.merge_in_progress', 'on', true);
     UPDATE enrolment_status_history SET reason = 'x' WHERE id = '00000000-0000-0000-0000-00000006f001'$q$,
  'append-only');
SELECT set_config('lead.merge_in_progress', 'off', true);
SELECT pg_temp.check('two changes in one transaction keep their order (clock_timestamp)',
  (SELECT a.changed_at < b.changed_at FROM enrolment_status_history a, enrolment_status_history b
   WHERE a.id = '00000000-0000-0000-0000-00000006f001' AND b.id = '00000000-0000-0000-0000-00000006f002'));
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000600d0', 'Person D0', 'd0006@x.test'),
  ('00000000-0000-0000-0000-0000000600d1', 'Person D1', 'd1006@x.test');
SELECT pg_temp.check('the new table is system-written: no version column, 15 versioned tables as before',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'enrolment_status_history' AND column_name = 'version')
  AND (SELECT count(*) = 15 FROM information_schema.columns WHERE column_name = 'version' AND table_schema = 'public'));
SELECT pg_temp.check('24 tables',
  (SELECT count(*) = 24 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'));

-- S-04 trigger: every writer is covered, no application code involved
SELECT pg_temp.check('inserting an enrolment wrote NULL -> status history',
  (SELECT count(*) = 1 FROM enrolment_status_history
   WHERE enrolment_id = '00000000-0000-0000-0000-00000006e0a1' AND from_status IS NULL AND to_status = 'confirmed'
     AND reason IS NULL AND changed_by IS NULL));
SELECT pg_temp.expect_ok('reserve, confirm, cancel (with a reason) and a no-op update',
  $q$INSERT INTO enrolment (id, person_id, class_id) VALUES
       ('00000000-0000-0000-0000-00000006e0b1', '00000000-0000-0000-0000-0000000600b1', '00000000-0000-0000-0000-00000006d001');
     UPDATE enrolment SET status = 'confirmed' WHERE id = '00000000-0000-0000-0000-00000006e0b1';
     UPDATE enrolment SET status = 'confirmed', onboarding_step = 1 WHERE id = '00000000-0000-0000-0000-00000006e0b1';
     UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'changed_mind' WHERE id = '00000000-0000-0000-0000-00000006e0b1'$q$);
SELECT pg_temp.check('three rows in order; the no-op update added none; the cancel row carries the reason',
  (SELECT array_agg(coalesce(from_status, '-') || '>' || to_status || '/' || coalesce(reason, '') ORDER BY changed_at)
          = ARRAY['->reserved/', 'reserved>confirmed/', 'confirmed>cancelled/changed_mind']
   FROM enrolment_status_history WHERE enrolment_id = '00000000-0000-0000-0000-00000006e0b1'));
SELECT pg_temp.expect_ok('a reservation whose hold has lapsed',
  $q$INSERT INTO enrolment (id, person_id, class_id, seat_reserved_until) VALUES
       ('00000000-0000-0000-0000-00000006e0b2', '00000000-0000-0000-0000-0000000600d0', '00000000-0000-0000-0000-00000006d001', now() + interval '1 hour');
     UPDATE enrolment SET seat_reserved_until = now() - interval '1 minute' WHERE id = '00000000-0000-0000-0000-00000006e0b2';
     SELECT expire_reservations()$q$);
SELECT pg_temp.check('the sweep wrote reserved > cancelled / reservation_expired',
  (SELECT array_agg(to_status || '/' || coalesce(reason, '') ORDER BY changed_at)
          = ARRAY['reserved/', 'cancelled/reservation_expired']
   FROM enrolment_status_history WHERE enrolment_id = '00000000-0000-0000-0000-00000006e0b2'));
SELECT pg_temp.expect_fail('a write the seat guard refuses leaves no history row',
  $q$UPDATE class SET capacity = 1 WHERE id = '00000000-0000-0000-0000-00000006d001';
     INSERT INTO enrolment (id, person_id, class_id, status) VALUES
       ('00000000-0000-0000-0000-00000006e0b3', '00000000-0000-0000-0000-0000000600d1', '00000000-0000-0000-0000-00000006d001', 'confirmed')$q$,
  'no_seats');
SELECT pg_temp.check('...and the refused enrolment is not there',
  NOT EXISTS (SELECT 1 FROM enrolment_status_history WHERE enrolment_id = '00000000-0000-0000-0000-00000006e0b3'));

-- S-05: class notes and cancellation, HRDC document
SELECT pg_temp.expect_ok('cancelling a class: cancelled_at is stamped by the database; notes and HRDC document key writable',
  $q$UPDATE class SET status = 'cancelled', cancelled_reason = 'trainer ill', notes = 'internal'
     WHERE id = '00000000-0000-0000-0000-00000006d002';
     UPDATE deal SET hrdc_document_key = 'hrdc/006.pdf' WHERE id = '00000000-0000-0000-0000-00000006de01'$q$);
SELECT pg_temp.check('cancelled_at is set, reason kept',
  (SELECT cancelled_at IS NOT NULL AND cancelled_reason = 'trainer ill' FROM class WHERE id = '00000000-0000-0000-0000-00000006d002'));
SELECT pg_temp.expect_ok('a class inserted as cancelled with no reason still gets cancelled_at (reason is the service''s job)',
  $q$INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, status) VALUES
     ('00000000-0000-0000-0000-00000006d003', '00000000-0000-0000-0000-00000006c0c0', 'T006-3', '2026-11-15', '2026-11-15', 'en', 'online', 'https://z', 10, 'cancelled')$q$);
SELECT pg_temp.check('...stamped',
  (SELECT cancelled_at IS NOT NULL FROM class WHERE id = '00000000-0000-0000-0000-00000006d003'));
SELECT pg_temp.expect_fail('an explicit NULL cancelled_at cannot beat the stamp: the CHECK holds the line when the status is untouched',
  $q$UPDATE class SET cancelled_at = NULL WHERE id = '00000000-0000-0000-0000-00000006d002'$q$,
  'class_cancelled_at_recorded');

-- S-06: the sweep's index exists (the CHECK and backfill are 007's, tested in 007_reservation_holds_tests.sql)
SELECT pg_temp.check('enrolment_reservation_expiry_idx is a partial index on reserved rows',
  (SELECT indexdef LIKE '%seat_reserved_until%' AND indexdef LIKE '%reserved%' FROM pg_indexes WHERE indexname = 'enrolment_reservation_expiry_idx'));


-- S-07: touchpoint external reference
SELECT pg_temp.expect_ok('touchpoint with external_ref accepted',
  $q$INSERT INTO touchpoint (id, person_id, channel, external_ref) VALUES
     ('00000000-0000-0000-0000-000000060f01', '00000000-0000-0000-0000-0000000600a1', 'import', 'batch006:1')$q$);
SELECT pg_temp.expect_fail('same (channel, external_ref) twice rejected',
  $q$INSERT INTO touchpoint (person_id, channel, external_ref) VALUES ('00000000-0000-0000-0000-0000000600b1', 'import', 'batch006:1')$q$,
  'touchpoint_external_ref_uq');
SELECT pg_temp.expect_ok('same external_ref on another channel, and NULL refs repeatedly, accepted',
  $q$INSERT INTO touchpoint (id, person_id, channel, external_ref) VALUES
       ('00000000-0000-0000-0000-000000060f02', '00000000-0000-0000-0000-0000000600a1', 'web_form', 'batch006:1'),
       ('00000000-0000-0000-0000-000000060f03', '00000000-0000-0000-0000-0000000600a1', 'import', NULL),
       ('00000000-0000-0000-0000-000000060f04', '00000000-0000-0000-0000-0000000600a1', 'import', NULL)$q$);
SELECT pg_temp.expect_fail('external_ref UPDATE refused',
  $q$UPDATE touchpoint SET external_ref = 'batch006:2' WHERE id = '00000000-0000-0000-0000-000000060f01'$q$,
  'append-only');
SELECT pg_temp.expect_fail('external_ref UPDATE refused even with lead.merge_in_progress = on',
  $q$SELECT set_config('lead.merge_in_progress', 'on', true);
     UPDATE touchpoint SET external_ref = 'batch006:2' WHERE id = '00000000-0000-0000-0000-000000060f01'$q$,
  'append-only');
SELECT set_config('lead.merge_in_progress', 'off', true);
SELECT pg_temp.expect_fail('setting external_ref on a NULL-ref row refused with the flag on',
  $q$SELECT set_config('lead.merge_in_progress', 'on', true);
     UPDATE touchpoint SET external_ref = 'late' WHERE id = '00000000-0000-0000-0000-000000060f03'$q$,
  'append-only');
SELECT set_config('lead.merge_in_progress', 'off', true);

-- S-08: deal -> source touchpoint
SELECT pg_temp.expect_ok('deal with source_touchpoint_id accepted',
  $q$UPDATE deal SET source_touchpoint_id = '00000000-0000-0000-0000-000000060f01' WHERE id = '00000000-0000-0000-0000-00000006de01'$q$);
SELECT pg_temp.expect_fail('source_touchpoint_id must be a real touchpoint',
  $q$UPDATE deal SET source_touchpoint_id = '00000000-0000-0000-0000-0000000fffff' WHERE id = '00000000-0000-0000-0000-00000006de01'$q$,
  'deal_source_touchpoint_id_fkey');

-- merge_person still works with the new columns
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000600c1', 'Merge Source', 'src006@x.test'),
  ('00000000-0000-0000-0000-0000000600c2', 'Merge Target', 'tgt006@x.test');
INSERT INTO touchpoint (id, person_id, channel, occurred_at, is_first_touch, external_ref) VALUES
  ('00000000-0000-0000-0000-000000060fc1', '00000000-0000-0000-0000-0000000600c1', 'lead_form', '2026-09-01', true, 'leadgen006:1'),
  ('00000000-0000-0000-0000-000000060fc2', '00000000-0000-0000-0000-0000000600c2', 'whatsapp',  '2026-09-05', true, 'wati006:1');
INSERT INTO deal (id, pipeline, stage, person_id, source_touchpoint_id, hrdc_document_key) VALUES
  ('00000000-0000-0000-0000-00000006dec1', 'individual', 'new', '00000000-0000-0000-0000-0000000600c1', '00000000-0000-0000-0000-000000060fc1', 'k1'),
  ('00000000-0000-0000-0000-00000006dec2', 'individual', 'new', '00000000-0000-0000-0000-0000000600c2', '00000000-0000-0000-0000-000000060fc2', NULL);
INSERT INTO task (id, type, title, person_id, payment_id, done_at, is_cancelled) VALUES
  ('00000000-0000-0000-0000-00000006a0c1', 'match_payment', 'Match', '00000000-0000-0000-0000-0000000600c1', '00000000-0000-0000-0000-000000069a02', NULL, false),
  ('00000000-0000-0000-0000-00000006a0c2', 'match_payment', 'Match', '00000000-0000-0000-0000-0000000600c2', '00000000-0000-0000-0000-000000069a03', now(), true);
SELECT pg_temp.expect_ok('merge_person runs with the new columns populated',
  $q$SELECT merge_person('00000000-0000-0000-0000-0000000600c1', '00000000-0000-0000-0000-0000000600c2', '00000000-0000-0000-0000-00000006000a')$q$);
SELECT pg_temp.check('merge moved touchpoints, deals and tasks; new columns unchanged',
  (SELECT count(*) = 2 AND bool_and(person_id = '00000000-0000-0000-0000-0000000600c2')
   AND array_agg(external_ref ORDER BY id) = ARRAY['leadgen006:1', 'wati006:1']
   FROM touchpoint WHERE id IN ('00000000-0000-0000-0000-000000060fc1', '00000000-0000-0000-0000-000000060fc2'))
  AND (SELECT count(*) = 2 AND bool_and(person_id = '00000000-0000-0000-0000-0000000600c2')
       AND array_agg(source_touchpoint_id ORDER BY id) = ARRAY['00000000-0000-0000-0000-000000060fc1', '00000000-0000-0000-0000-000000060fc2']::uuid[]
       FROM deal WHERE id IN ('00000000-0000-0000-0000-00000006dec1', '00000000-0000-0000-0000-00000006dec2'))
  AND (SELECT count(*) = 2 AND bool_and(person_id = '00000000-0000-0000-0000-0000000600c2')
       AND array_agg(payment_id ORDER BY id) = ARRAY['00000000-0000-0000-0000-000000069a02', '00000000-0000-0000-0000-000000069a03']::uuid[]
       AND array_agg(is_cancelled ORDER BY id) = ARRAY[false, true]
       FROM task WHERE id IN ('00000000-0000-0000-0000-00000006a0c1', '00000000-0000-0000-0000-00000006a0c2')));

-- erase_person still runs
SELECT pg_temp.expect_ok('erase_person runs on the merged survivor',
  $q$SELECT erase_person('00000000-0000-0000-0000-0000000600c2', '00000000-0000-0000-0000-00000006000a', 'PDPA test 006')$q$);
SELECT pg_temp.check('erase cleared the survivor and kept its tasks and touchpoints',
  (SELECT full_name = 'Erased person' AND erased_at IS NOT NULL FROM person WHERE id = '00000000-0000-0000-0000-0000000600c2')
  AND (SELECT count(*) = 2 FROM task WHERE person_id = '00000000-0000-0000-0000-0000000600c2')
  AND (SELECT count(*) = 2 FROM touchpoint WHERE person_id = '00000000-0000-0000-0000-0000000600c2'));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
