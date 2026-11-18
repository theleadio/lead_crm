-- =============================================================================
-- LEAD CRM — migration 025
-- Adds `guest` to the seat funding values (enrolment.funding_type, 023).
--
-- The LMS records a sixth funding value, `guest` (1 seat on 13 Nov 2026). 023
-- allowed only the five seen on 2 Nov, so the LMS sync leaves that seat empty
-- and logs a warning. Shawn's review of #76 (13 Nov): widen the CHECK rather
-- than store it as `internal`, so the real value is kept.
--
-- Widens only: every value 023 accepts is still accepted, so no existing row
-- or code is affected. The constraint keeps its 023 name. Takes a short lock
-- on enrolment while the CHECK is re-validated (a few hundred rows).
-- Re-running is harmless. Rollback (clear guest seats first, or it fails):
--   UPDATE enrolment SET funding_type = NULL WHERE funding_type = 'guest';
--   ALTER TABLE enrolment DROP CONSTRAINT enrolment_funding_type_check,
--     ADD CONSTRAINT enrolment_funding_type_check
--     CHECK (funding_type IN ('self_funded', 'hrdc', 'internal', 'leaders_club', 'refresher'));
-- 13 Nov 2026.
-- =============================================================================

BEGIN;

ALTER TABLE enrolment DROP CONSTRAINT IF EXISTS enrolment_funding_type_check;
ALTER TABLE enrolment ADD CONSTRAINT enrolment_funding_type_check
  CHECK (funding_type IN ('self_funded', 'hrdc', 'internal', 'leaders_club', 'refresher', 'guest'));

COMMIT;
