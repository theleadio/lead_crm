-- =============================================================================
-- LEAD CRM — migration 015
-- Campaign id and ad id on touchpoint, for the SalesProcess attribution import
-- (scripts/import-ghl-attribution.ts).
--
-- SalesProcess (GoHighLevel) keeps, per attribution record, the ad platform's
-- own campaign id (utmCampaignId) and ad id (utmAdId) next to the campaign name.
-- Joining on those ids to meta_ad_insight (campaign_id, ad_id) is exact; joining
-- on names is not (the same campaign arrives in two letter cases, and some
-- records hold the numeric campaign id in the name field). Nothing else in the
-- schema can hold them: utm_campaign is the name, utm_content is the creative.
--
-- Nullable, no default, no backfill (no source for old rows). Append-only
-- without touching forbid_change(), as in 013: it compares to_jsonb(NEW) minus
-- person_id and is_first_touch, so new columns are covered. merge_person() and
-- erase_person() list no touchpoint columns and need no change. Partial indexes,
-- because most touchpoints will never carry either id and the report joins on
-- them.
--
-- Re-running is harmless. Owner: Shawn. 30 Oct 2026.
-- =============================================================================

BEGIN;

ALTER TABLE touchpoint
  ADD COLUMN IF NOT EXISTS utm_campaign_id text,
  ADD COLUMN IF NOT EXISTS utm_ad_id       text;

CREATE INDEX IF NOT EXISTS touchpoint_utm_campaign_id_idx
  ON touchpoint (utm_campaign_id) WHERE utm_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS touchpoint_utm_ad_id_idx
  ON touchpoint (utm_ad_id) WHERE utm_ad_id IS NOT NULL;

COMMIT;
