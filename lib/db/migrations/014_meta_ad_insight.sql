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
-- pixel leads are both reported under it). `messages` and `checkouts` are single
-- action_types too: onsite_conversion.messaging_conversation_started_7d and
-- offsite_conversion.fb_pixel_initiate_checkout.
--
-- `objective` is the campaign objective exactly as Meta sent it (OUTCOME_SALES,
-- MESSAGES, ...); nothing here interprets it; NULL when Meta omitted it.
-- `inline_link_clicks` is link clicks only, for a link CTR like Ads Manager's;
-- `clicks` still counts every click.
-- `url_tags` is the ad creative's literal UTM string, so a report can join to
-- touchpoint.utm_campaign exactly instead of matching campaign_name. It is per
-- ad, copied onto each daily row, from a second API call (the ads edge); NULL
-- when Meta returned none or that call failed. A NULL never overwrites a tag.
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
  objective     text,
  messages      integer       NOT NULL DEFAULT 0 CHECK (messages >= 0),
  checkouts     integer       NOT NULL DEFAULT 0 CHECK (checkouts >= 0),
  inline_link_clicks integer  NOT NULL DEFAULT 0 CHECK (inline_link_clicks >= 0),
  url_tags      text,
  synced_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, day)
);
-- For a database that already has the first version of this table.
ALTER TABLE meta_ad_insight ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE meta_ad_insight ADD COLUMN IF NOT EXISTS messages integer NOT NULL DEFAULT 0 CHECK (messages >= 0);
ALTER TABLE meta_ad_insight ADD COLUMN IF NOT EXISTS checkouts integer NOT NULL DEFAULT 0 CHECK (checkouts >= 0);
ALTER TABLE meta_ad_insight ADD COLUMN IF NOT EXISTS inline_link_clicks integer NOT NULL DEFAULT 0 CHECK (inline_link_clicks >= 0);
ALTER TABLE meta_ad_insight ADD COLUMN IF NOT EXISTS url_tags text;

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
