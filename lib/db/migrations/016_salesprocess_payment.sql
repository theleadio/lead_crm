-- =============================================================================
-- LEAD CRM — migration 016
-- SalesProcess (GoHighLevel) payment transactions, pulled by
-- scripts/sync-salesprocess-payments.ts, so the ads report has revenue.
--
-- Why not `payment`: every payment row needs a deal or an enrolment (or is an
-- unmatched Stripe payment, which raises a match task for Ops). SalesProcess
-- sales have neither: they are sold through SalesProcess funnels, not CRM
-- deals, and the LMS records no amount. 1,446 rows as unmatched payments
-- would flood the Ops queue. This table is a flat copy, like meta_ad_insight
-- (014), and the source to load into `payment` if those sales move to the CRM.
--
-- One row per SalesProcess transaction (its _id). The sync re-reads every
-- transaction and upserts: status and refunds change after the sale, so a
-- re-run updates them and is otherwise harmless. Values as SalesProcess sent
-- them: `status` is succeeded / failed / pending / refunded /
-- partially_refunded, `live_mode` false is a test charge. Money numeric(12,2).
--
-- No person_id. A sale joins to its buyer through the contact id: the person
-- whose touchpoint has external_ref 'ghl:' || ghl_contact_id (ghl:import).
-- Touchpoints move with a merge, so that join follows merged people without
-- this table knowing about merges or erasure.
--
-- Not reachable from the browser: privileges revoked from anon/authenticated.
-- Owner: Shawn. 3 Nov 2026.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS salesprocess_payment (
  id             text          PRIMARY KEY,
  order_id       text,
  ghl_contact_id text          NOT NULL,
  status         text          NOT NULL,
  amount_myr     numeric(12,2) NOT NULL CHECK (amount_myr >= 0),
  refunded_myr   numeric(12,2) NOT NULL DEFAULT 0
                   CHECK (refunded_myr >= 0 AND refunded_myr <= amount_myr),
  currency       text          NOT NULL,
  product        text,
  live_mode      boolean       NOT NULL,
  paid_at        timestamptz   NOT NULL,
  synced_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salesprocess_payment_contact_idx
  ON salesprocess_payment (ghl_contact_id);
CREATE INDEX IF NOT EXISTS salesprocess_payment_paid_idx
  ON salesprocess_payment (paid_at);

ALTER TABLE salesprocess_payment ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON salesprocess_payment FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
