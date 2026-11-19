-- =============================================================================
-- LEAD CRM — 026 (data only, no schema change)
-- Fills app_user.last_login_at from each user's latest sign-in in the audit log.
--
-- Nothing wrote last_login_at before the Settings screen (§9.15), so every
-- user who already signs in would show as "Not signed in yet" on the Users
-- tab. lib/auth/sign-in.ts has written a `sign_in` audit row on every
-- successful sign-in since 29 Oct 2026; this copies the latest one across.
--
-- Only empty values are filled, so it never moves a time sign-in has already
-- written, and running it twice changes nothing. A user with no `sign_in` row
-- stays empty ("Not signed in yet" is then true). `sign_in_failed` rows are
-- ignored. Uses audit_log.at, the event time every reader of the log uses.
-- Run before the deploy, on each database, then its test
-- (lib/db/tests/026_backfill_last_login_tests.sql).
-- Rollback: none needed; the values are true sign-in times, and the next
-- sign-in overwrites them anyway.
-- 14 Nov 2026 (settings-screen design 11).
-- =============================================================================
BEGIN;

UPDATE app_user u
SET last_login_at = s.last_sign_in
FROM (SELECT user_id, max(at) AS last_sign_in
      FROM audit_log
      WHERE action = 'sign_in' AND user_id IS NOT NULL
      GROUP BY user_id) s
WHERE s.user_id = u.id AND u.last_login_at IS NULL;

COMMIT;
