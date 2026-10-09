-- =============================================================================
-- 008: one proof file, one payment
-- 9 Oct 2026. Owner: Shawn. From Zixuan's 9.12 questions (manual payment modal).
--
-- A double-click or a retry on the manual payment modal can submit the same
-- uploaded proof twice. Only the database can make that impossible for every
-- writer, so the same proof_file_key may appear on one payment row only.
-- NULL stays allowed any number of times (Stripe payments have no proof).
--
-- If this fails with "could not create unique index", two payments already
-- share a proof file. List them with:
--   SELECT proof_file_key, count(*) FROM payment
--   WHERE proof_file_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- and decide by hand which row is the real one. Nothing is changed for you.
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX payment_proof_key_uq ON payment (proof_file_key)
  WHERE proof_file_key IS NOT NULL;

COMMIT;
