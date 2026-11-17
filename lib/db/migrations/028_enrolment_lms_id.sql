-- =============================================================================
-- LEAD CRM — migration 028
-- Adds enrolment.lms_enrollment_id: the LMS's id for the same seat.
--
-- Today a seat that came from the LMS has the LMS's id as its own id, but a
-- seat the CRM makes (SalesProcess import, staff, and soon /register through
-- the hand-off) keeps a CRM id, and the LMS gives it another. Jaman's point 8
-- (16 Nov 2026): store the LMS's seat id on the CRM seat and match on it, so
-- the sync never makes a second seat. It also marks a seat the LMS has
-- confirmed, which the sync needs before it may cancel a seat the LMS has
-- removed (Shawn's answer 3, 16 Nov).
--
-- Nullable, no backfill here: the LMS sync fills it for every seat it matches,
-- and the hand-off sender (lead_sales) will fill it from the LMS's reply.
-- One LMS seat belongs to at most one CRM seat (partial unique index).
-- Adds a column with no default, so no table rewrite; the index build takes a
-- short lock on enrolment (a few hundred rows). Re-running is harmless.
-- Rollback:
--   DROP INDEX IF EXISTS enrolment_lms_enrollment_id_uq;
--   ALTER TABLE enrolment DROP COLUMN IF EXISTS lms_enrollment_id;
-- 17 Nov 2026. Must land before the 27 Nov schema freeze.
-- =============================================================================

BEGIN;

ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS lms_enrollment_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS enrolment_lms_enrollment_id_uq
  ON enrolment (lms_enrollment_id) WHERE lms_enrollment_id IS NOT NULL;

COMMIT;
