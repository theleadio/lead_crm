-- Tests for migration 008. Run on an empty database after 001-009. Rolls itself back.
-- Every succeeded payment carries paid_at: migration 009 (payment_paid_at_when_paid) refuses one without.
BEGIN;
CREATE TEMP TABLE results (name text, ok boolean);
CREATE FUNCTION pg_temp.check(test_name text, cond boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (test_name, coalesce(cond, false));
$$;
CREATE FUNCTION pg_temp.expect_fail(test_name text, stmt text, msg_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (test_name, false);
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (test_name, SQLERRM LIKE msg_like); END;
END $$;

INSERT INTO course (id, code, name_en, track, duration_days) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'AIM', 'AI Mastery', 'mastery', 2);
INSERT INTO class (id, course_id, code, start_date, end_date, language, mode, online_url, capacity, few_seats_threshold, status) VALUES
  ('00000000-0000-0000-0000-0000000c1a55', '00000000-0000-0000-0000-00000000c001', 'K1', current_date + 30, current_date + 31, 'en', 'online', 'https://x', 5, 1, 'open');
INSERT INTO person (id, full_name, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'A', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'B', 'b@x.com');
INSERT INTO enrolment (id, person_id, class_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1a55', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000c1a55', 'confirmed');

SELECT pg_temp.check('index payment_proof_key_uq exists',
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'payment_proof_key_uq'));

INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no, proof_file_key, paid_at) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'bank_transfer', 'succeeded', 3200, 'REF1', 'proofs/a.pdf', now());
SELECT pg_temp.check('first payment with a proof saves', (SELECT count(*) = 1 FROM payment));

SELECT pg_temp.expect_fail('same proof on a second payment (double-submit) is refused',
  $q$INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no, proof_file_key, paid_at)
     VALUES ('00000000-0000-0000-0000-0000000000e1', 'bank_transfer', 'succeeded', 3200, 'REF1', 'proofs/a.pdf', now())$q$,
  '%payment_proof_key_uq%');
SELECT pg_temp.expect_fail('same proof on a different enrolment is also refused',
  $q$INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no, proof_file_key, paid_at)
     VALUES ('00000000-0000-0000-0000-0000000000e2', 'bank_transfer', 'succeeded', 3200, 'REF2', 'proofs/a.pdf', now())$q$,
  '%payment_proof_key_uq%');

INSERT INTO payment (enrolment_id, method, status, amount_myr, reference_no, proof_file_key, paid_at) VALUES
  ('00000000-0000-0000-0000-0000000000e2', 'bank_transfer', 'succeeded', 3200, 'REF2', 'proofs/b.pdf', now());
SELECT pg_temp.check('a different proof file saves', (SELECT count(*) = 2 FROM payment));

INSERT INTO payment (enrolment_id, method, status, amount_myr, paid_at) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'stripe_card', 'succeeded', 100, now()),
  ('00000000-0000-0000-0000-0000000000e2', 'stripe_card', 'succeeded', 100, now());
SELECT pg_temp.check('payments with no proof (Stripe) are not limited',
  (SELECT count(*) = 4 FROM payment));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
