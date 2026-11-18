-- =============================================================================
-- LEAD CRM — migration 030
-- Opt-in source on touchpoint: source_type and entry_point.
--
-- Plan docs/superpowers/plans/2026-11-18-opt-in-source-tracking.md, phase 1
-- (Shawn chose new columns, 18 Nov 2026). 98% of people have a first touch
-- that is only the `ghl-export` import label, so the CRM cannot say where
-- most leads opted in. These two columns say it in one place:
--   source_type  what kind of door: paid_ad, organic_social, email, whatsapp,
--                community, referral, event, partner_ticket, website.
--   entry_point  which door: a form, landing page, ad, webinar or masterclass.
-- utm_* and the click ids stay as they are; they are detail, not the answer.
--
-- Nullable, no default, no backfill here (the backfill inserts new touches, see
-- scripts/backfill-tag-source.ts). Append-only without touching forbid_change():
-- it compares to_jsonb(NEW) minus person_id and is_first_touch, so new columns
-- are covered (same reasoning as 013 and 015). merge_person() and
-- erase_person() list no touchpoint columns and need no change.
-- The list in the CHECK matches lib/import/tag-source.ts SOURCE_TYPES; widen
-- both together. A partial index, because most touches will not carry one.
--
-- Re-running is harmless. Must land before the 27 Nov schema freeze.
-- Rollback:
--   DROP INDEX IF EXISTS touchpoint_source_type_idx;
--   ALTER TABLE touchpoint DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS entry_point;
-- =============================================================================

BEGIN;

ALTER TABLE touchpoint
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS entry_point text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'touchpoint_source_type_check') THEN
    ALTER TABLE touchpoint ADD CONSTRAINT touchpoint_source_type_check
      CHECK (source_type IS NULL OR source_type IN
        ('paid_ad','organic_social','email','whatsapp','community','referral',
         'event','partner_ticket','website'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS touchpoint_source_type_idx
  ON touchpoint (source_type) WHERE source_type IS NOT NULL;

COMMIT;
