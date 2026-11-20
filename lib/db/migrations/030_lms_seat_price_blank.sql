-- =============================================================================
-- LEAD CRM — migration 030 (one-off data fix, no schema change)
-- Blanks RM 0 on the seats the LMS sync made: RM 0 there means "no price".
--
-- Every LMS seat has amount_paid_cents 0, and the sync used to copy that as
-- RM 0. Since #87 it writes NULL on insert and never updates the price of an
-- existing seat, so the old RM 0 seats stay until this runs (Shawn, review on
-- #87, 18 Nov 2026: a separate one-off).
--
-- Which seats: price 0, made by the LMS sync (the seat's id IS its LMS seat id,
-- which the sync saves since #88), and no CRM payment. Seats the CRM made
-- (Stripe, SalesProcess, staff) keep whatever price they hold, 0 included.
-- On 19 Nov: 432 such seats (274 self_funded, 105 hrdc, 32 internal,
-- 15 leaders_club, 5 refresher, 1 guest), none with a payment.
--
-- Run AFTER the first nightly LMS sync with #88: before it, no seat has its
-- LMS id, so this would match nothing. It refuses to run in that case.
-- Re-running is harmless (nothing left at 0).
-- Rollback (puts back 0 on LMS-made seats with no price; after this runs, the
-- sync only inserts NULL, so it would also hit seats made since):
--   UPDATE enrolment SET price_paid_myr = 0
--   WHERE price_paid_myr IS NULL AND lms_enrollment_id = id;
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM enrolment WHERE lms_enrollment_id = id) THEN
    RAISE EXCEPTION '030: no seat has its LMS id yet; run after the first LMS sync with #88';
  END IF;
END $$;

UPDATE enrolment e SET price_paid_myr = NULL
WHERE e.price_paid_myr = 0
  AND e.lms_enrollment_id = e.id
  AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.enrolment_id = e.id);

COMMIT;
