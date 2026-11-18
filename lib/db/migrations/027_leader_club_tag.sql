-- =============================================================================
-- LEAD CRM — 027 (data only, no schema change)
-- Seeds the "LEADER Club" person tag as a system tag.
--
-- Membership of LEADER Club is a person tag (decided 12 Nov 2026). As a user
-- tag, Settings → Tags would let anyone rename, deactivate or merge it away;
-- a system tag is locked there (Shawn, #84, 16 Nov). If a tag with that name
-- already exists in any case, it is promoted and reactivated, keeping its id,
-- its name and its people. Running it twice changes nothing.
-- Members are added separately (from the member list), not here.
-- Run on each database, then its test (lib/db/tests/027_leader_club_tag_tests.sql).
-- Rollback: UPDATE tag SET is_system = false WHERE lower(name) = 'leader club';
-- =============================================================================
BEGIN;

INSERT INTO tag (name, is_system) VALUES ('LEADER Club', true)
ON CONFLICT ((lower(name))) DO UPDATE SET is_system = true, is_active = true;

COMMIT;
