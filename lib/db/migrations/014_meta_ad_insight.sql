-- =============================================================================
-- LEAD CRM — migration 014
-- Daily Meta Ads numbers, one row per ad per day, pulled by
-- scripts/sync-meta-ads.ts from the Marketing API insights endpoint.
--
-- Deliberately flat. Spec §5 defers `campaign`, `ad` and `ad_metric_daily` to
-- January; this is the one table that lets spend and leads be read today
-- without building those three. Names and ids are copied from Meta as they
-- were on the day, so a renamed campaign keeps its old name on old rows. When
-- the January tables arrive, this one is the source to load them from.
--
-- Natural key (ad_id, day). The sync re-reads the last few days every run
-- (Meta restates recent numbers) and upserts, so re-running is harmless.
-- Money: numeric(12,2), never float. `currency` is Meta's account currency;
-- the spec says MYR only, so anything else is stored as it came, not converted.
-- `leads` counts Meta's `lead` action only (on-Facebook instant forms and
-- pixel leads are both reported under it).
--
-- No person_id: nothing joins an ad row to a lead yet. touchpoint.utm_campaign
-- is the loose link (compare it to campaign_name); a real one is O30.
--
-- Not reachable from the browser: privileges revoked from anon/authenticated.
-- Owner: Shawn. 29 Oct 2026.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS meta_ad_insight (
  ad_id         text          NOT NULL,
  day           date          NOT NULL,
  account_id    text          NOT NULL,
  campaign_id   text          NOT NULL,
  campaign_name text          NOT NULL,
  adset_id      text          NOT NULL,
  adset_name    text          NOT NULL,
  ad_name       text          NOT NULL,
  currency      text          NOT NULL,
  spend         numeric(12,2) NOT NULL CHECK (spend >= 0),
  impressions   integer       NOT NULL CHECK (impressions >= 0),
  clicks        integer       NOT NULL CHECK (clicks >= 0),
  leads         integer       NOT NULL DEFAULT 0 CHECK (leads >= 0),
  synced_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, day)
);
CREATE INDEX IF NOT EXISTS meta_ad_insight_day_idx ON meta_ad_insight (day);
CREATE INDEX IF NOT EXISTS meta_ad_insight_campaign_idx ON meta_ad_insight (campaign_id, day);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON meta_ad_insight FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
