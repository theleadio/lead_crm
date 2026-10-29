-- =============================================================================
-- LEAD CRM — migration 013
-- The other ad-click identifiers on touchpoint (O61, proposal of 29 Oct:
-- docs/superpowers/notes/2026-10-29-click-id-capture-proposal.md).
--
-- gbraid / wbraid: Google sends these instead of gclid for iOS clicks.
-- li_fat_id: LinkedIn, with enhanced conversion tracking on. ttclid: TikTok.
-- Captured like gclid and fbclid; nothing reads them until the January
-- conversion uploads, but a lead stored without one can never get it back.
--
-- Nullable, no default, no backfill (there is no source for old values), no
-- index (nothing looks a lead up by click id yet). Lengths are capped by the
-- §8.2 schema, as for gclid. Append-only without touching forbid_change():
-- it compares to_jsonb(NEW) - person_id - is_first_touch, so new columns are
-- covered (same reasoning as external_ref in 009). merge_person() and
-- erase_person() list no touchpoint columns and need no change.
--
-- Re-running is harmless. Owner: Shawn. 29 Oct 2026.
-- =============================================================================

BEGIN;

ALTER TABLE touchpoint
  ADD COLUMN IF NOT EXISTS gbraid    text,
  ADD COLUMN IF NOT EXISTS wbraid    text,
  ADD COLUMN IF NOT EXISTS li_fat_id text,
  ADD COLUMN IF NOT EXISTS ttclid    text;

COMMIT;
