-- =============================================================================
-- LEAD CRM — migration 029
-- Adds class.lms_cohort_id: the LMS's id for the same class (an LMS cohort).
--
-- A class that came from the LMS has the LMS's id as its own id, but a class
-- made in the CRM (SalesProcess import, or by hand) keeps a CRM id, and the
-- LMS cohort for it has another (vibe-coding-23-Nov on 17 Nov). The CRM → LMS
-- sender must name the LMS class in enrol and move, and holds an enrol while
-- its class has no LMS id yet (Shawn, 17 Nov 2026). The LMS sync fills it.
--
-- Nullable, no backfill here: the LMS sync fills it for every class it links.
-- One LMS cohort belongs to at most one CRM class (partial unique index).
-- Adds a column with no default, so no table rewrite; the index build takes a
-- short lock on class (a few dozen rows). Re-running is harmless.
-- Rollback:
--   DROP INDEX IF EXISTS class_lms_cohort_id_uq;
--   ALTER TABLE class DROP COLUMN IF EXISTS lms_cohort_id;
-- 17 Nov 2026. Must land before the 27 Nov schema freeze.
-- =============================================================================

BEGIN;

ALTER TABLE class ADD COLUMN IF NOT EXISTS lms_cohort_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS class_lms_cohort_id_uq
  ON class (lms_cohort_id) WHERE lms_cohort_id IS NOT NULL;

COMMIT;
