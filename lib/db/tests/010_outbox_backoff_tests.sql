-- Tests for migration 010. Run on an empty database after 001-010 (also runs on a
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

-- Defaults of the new columns
INSERT INTO event_outbox (id, type, aggregate_type, aggregate_id) VALUES
  ('00000000-0000-0000-0000-0000000700a1', 'T', 'x', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000700a2', 'T', 'x', gen_random_uuid());
SELECT pg_temp.check('event_outbox: next_attempt_at defaults to now(), dead_at to NULL',
  (SELECT bool_and(next_attempt_at = now() AND dead_at IS NULL) FROM event_outbox
   WHERE id IN ('00000000-0000-0000-0000-0000000700a1', '00000000-0000-0000-0000-0000000700a2')));
SELECT pg_temp.check('event_outbox: seq is filled in, increasing in insert order',
  (SELECT seq IS NOT NULL FROM event_outbox WHERE id = '00000000-0000-0000-0000-0000000700a1')
  AND (SELECT a.seq < b.seq FROM event_outbox a, event_outbox b
       WHERE a.id = '00000000-0000-0000-0000-0000000700a1' AND b.id = '00000000-0000-0000-0000-0000000700a2'));
SELECT pg_temp.expect_fail('event_outbox: seq cannot be written (GENERATED ALWAYS)',
  $q$INSERT INTO event_outbox (type, aggregate_type, aggregate_id, seq) VALUES ('T', 'x', gen_random_uuid(), 1)$q$,
  'seq');
SELECT pg_temp.check('event_outbox: seq is an identity column, NOT NULL',
  (SELECT is_identity = 'YES' AND identity_generation = 'ALWAYS' AND is_nullable = 'NO' AND data_type = 'bigint'
   FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'event_outbox' AND column_name = 'seq'));

-- The CHECK
SELECT pg_temp.expect_fail('dead and processed together is refused',
  $q$INSERT INTO event_outbox (type, aggregate_type, aggregate_id, dead_at, processed_at) VALUES ('T', 'x', gen_random_uuid(), now(), now())$q$,
  'event_outbox_dead_is_pending');
SELECT pg_temp.expect_ok('dead and pending is accepted',
  $q$INSERT INTO event_outbox (type, aggregate_type, aggregate_id, dead_at, attempts) VALUES ('T', 'x', gen_random_uuid(), now(), 5)$q$);
SELECT pg_temp.expect_fail('marking a dead row processed is refused',
  $q$UPDATE event_outbox SET processed_at = now() WHERE dead_at IS NOT NULL$q$,
  'event_outbox_dead_is_pending');

-- Indexes
SELECT pg_temp.check('event_outbox_due_idx is (next_attempt_at, seq) over live pending rows',
  (SELECT pg_get_indexdef(i.indexrelid) LIKE '%(next_attempt_at, seq)%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%processed_at IS NULL%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%dead_at IS NULL%'
   FROM pg_index i WHERE i.indexrelid = to_regclass('event_outbox_due_idx')));
SELECT pg_temp.check('event_outbox_pending_idx is gone', to_regclass('event_outbox_pending_idx') IS NULL);
SELECT pg_temp.check('integration_event_due_idx is (next_attempt_at) for received/failed',
  (SELECT pg_get_indexdef(i.indexrelid) LIKE '%(next_attempt_at)%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%received%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%failed%'
      AND pg_get_expr(i.indpred, i.indrelid) NOT LIKE '%processed%'
   FROM pg_index i WHERE i.indexrelid = to_regclass('integration_event_due_idx')));

-- integration_event columns
INSERT INTO integration_event (id, source, external_event_id, payload) VALUES
  ('00000000-0000-0000-0000-0000000700b1', 'test007', 'e1', '{}');
SELECT pg_temp.check('integration_event: attempts defaults to 0, next_attempt_at to now()',
  (SELECT attempts = 0 AND next_attempt_at = now() FROM integration_event
   WHERE id = '00000000-0000-0000-0000-0000000700b1'));
SELECT pg_temp.check('integration_event: attempts integer NOT NULL, next_attempt_at timestamptz NOT NULL',
  (SELECT count(*) = 2 FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'integration_event' AND is_nullable = 'NO'
     AND ((column_name = 'attempts' AND data_type = 'integer')
       OR (column_name = 'next_attempt_at' AND data_type = 'timestamp with time zone'))));

-- Backfill: replay the migration's seq and dead_at steps on rows that look like
-- a pre-010 table (same SQL as 010 sections 2 and 3). Dropping seq also drops
-- the due index; the whole script rolls back.
DELETE FROM event_outbox;
ALTER TABLE event_outbox DROP COLUMN seq;
INSERT INTO event_outbox (id, type, aggregate_type, aggregate_id, created_at, processed_at, attempts) VALUES
  ('00000000-0000-0000-0000-0000000700c3', 'T', 'x', gen_random_uuid(), '2026-01-03 10:00+00', NULL, 0),
  ('00000000-0000-0000-0000-0000000700c1', 'T', 'x', gen_random_uuid(), '2026-01-01 10:00+00', '2026-01-01 10:01+00', 1),
  ('00000000-0000-0000-0000-0000000700c5', 'T', 'x', gen_random_uuid(), '2026-01-05 10:00+00', NULL, 5),
  ('00000000-0000-0000-0000-0000000700c2', 'T', 'x', gen_random_uuid(), '2026-01-03 10:00+00', NULL, 2),
  ('00000000-0000-0000-0000-0000000700c4', 'T', 'x', gen_random_uuid(), '2026-01-02 10:00+00', '2026-01-02 10:01+00', 5);
DO $$
BEGIN
  ALTER TABLE event_outbox ADD COLUMN seq bigint;
  UPDATE event_outbox o SET seq = n.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM event_outbox) n
  WHERE o.id = n.id;
  ALTER TABLE event_outbox ALTER COLUMN seq SET NOT NULL;
  ALTER TABLE event_outbox ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;
  PERFORM setval(pg_get_serial_sequence('event_outbox', 'seq'),
                 coalesce(max(seq), 1), max(seq) IS NOT NULL)
  FROM event_outbox;
END $$;
UPDATE event_outbox SET dead_at = now()
WHERE processed_at IS NULL AND dead_at IS NULL AND attempts >= 5;
SELECT pg_temp.check('backfill: seq follows (created_at, id), including a created_at tie',
  (SELECT array_agg(right(id::text, 2) ORDER BY seq) = ARRAY['c1', 'c4', 'c2', 'c3', 'c5'] FROM event_outbox)
  AND (SELECT array_agg(seq ORDER BY seq) = ARRAY[1, 2, 3, 4, 5]::bigint[] FROM event_outbox));
INSERT INTO event_outbox (id, type, aggregate_type, aggregate_id) VALUES
  ('00000000-0000-0000-0000-0000000700c6', 'T', 'x', gen_random_uuid());
SELECT pg_temp.check('backfill: a new row gets the next seq after the backfilled ones',
  (SELECT seq = 6 FROM event_outbox WHERE id = '00000000-0000-0000-0000-0000000700c6'));
SELECT pg_temp.check('backfill: only the pending row with attempts >= 5 became dead',
  (SELECT array_agg(right(id::text, 2) ORDER BY id) = ARRAY['c5'] FROM event_outbox WHERE dead_at IS NOT NULL));
SELECT pg_temp.check('backfill: processed rows are untouched, nothing deleted',
  (SELECT count(*) = 2 FROM event_outbox WHERE processed_at IS NOT NULL AND dead_at IS NULL)
  AND (SELECT count(*) = 6 FROM event_outbox));

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results;
SELECT count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' AS summary FROM results;
ROLLBACK;
