-- =============================================================================
-- LEAD CRM — migration 023
-- Two pre-freeze additions agreed with Shawn on 12 Nov 2026 (before the
-- 27 Nov freeze):
--
-- 1. class_meta_campaign: which Meta campaigns sell which class. Until now
--    the only link was the campaign name, and names drift (the 19 Nov
--    masterclass ran under two spellings). Keyed on Meta's campaign id, so a
--    rename or a second spelling changes nothing. One class can have many
--    campaigns; a campaign belongs to one class at most (UNIQUE below), so a
--    campaign's opt-ins are never counted on two class cards. campaign_name is
--    a copy for display only, taken when the link is made; never join on it.
--    meta_campaign_id has no foreign key: meta_ad_insight is keyed per ad per
--    day, and a campaign can be linked before its first spend row arrives.
--
-- 2. enrolment.funding_type: how this one seat is paid, using the LMS's own
--    values (enrollments.funding_type, 387 rows read on 2 Nov): self_funded,
--    hrdc, internal, leaders_club, refresher. Who pays stays in payer_type
--    (self/company). Needed because ops will record seats in the CRM only, and
--    most seats have no deal to read deal.funding_type from (Roster adds,
--    imports, /register). deal.funding_type is unchanged.
--    Nullable with no default: existing rows are unknown until a sync fills
--    them from the LMS. That fill is a separate data step, not part of this
--    migration. The LMS's full list is still to come from its owner; a new
--    value needs a follow-up migration that widens the CHECK.
--    The row-version trigger (005) is column-agnostic, so a change to
--    funding_type bumps `version` like any other.
--
-- Additive only: no existing column, constraint or row changes, so code that
-- doesn't know about either keeps working. Rollback:
--   DROP TABLE class_meta_campaign;
--   ALTER TABLE enrolment DROP CONSTRAINT enrolment_funding_type_check,
--                         DROP COLUMN funding_type;
--
-- Not reachable from the browser: privileges revoked from anon/authenticated.
-- Re-running is harmless. 12 Nov 2026.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS class_meta_campaign (
  class_id          uuid        NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  meta_campaign_id  text        NOT NULL CHECK (meta_campaign_id ~ '^[0-9]+$'),
  campaign_name     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES app_user(id),
  PRIMARY KEY (class_id, meta_campaign_id),
  CONSTRAINT class_meta_campaign_one_class UNIQUE (meta_campaign_id)
);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON class_meta_campaign FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS funding_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrolment_funding_type_check') THEN
    ALTER TABLE enrolment ADD CONSTRAINT enrolment_funding_type_check
      CHECK (funding_type IN ('self_funded', 'hrdc', 'internal', 'leaders_club', 'refresher'));
  END IF;
END $$;

COMMIT;
