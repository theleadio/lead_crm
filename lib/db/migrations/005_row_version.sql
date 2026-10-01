-- 005: integer row version for optimistic concurrency (If-Match).
-- Why: updated_at is set by now(), which is the transaction start time. Two writes in one
-- transaction leave it unchanged, and a transaction that started earlier but commits later can
-- write an older value. It is also microsecond precision, which JS Date and text round-trips
-- can lose. An integer that goes up by exactly 1 on every UPDATE has none of these problems.
-- The API hands out `version` as the ETag and PATCHes with WHERE id = $1 AND version = $2.
-- Zero rows updated = 409 (or 404 if the row is gone).

CREATE OR REPLACE FUNCTION bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;   -- ignores any value the app tries to write
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user','app_setting','person','company','company_membership','tag',
    'course','class','class_notice','lost_reason','deal','enrolment','payment',
    'enquiry','task'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN version bigint NOT NULL DEFAULT 1', t);
    EXECUTE format('CREATE TRIGGER %I_bump_version BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION bump_version()', t, t);
  END LOOP;
END $$;
