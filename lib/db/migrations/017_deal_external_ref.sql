-- =============================================================================
-- LEAD CRM — migration 017
-- deal.external_ref: the source system's id for a deal another system made,
-- so an import can run again without duplicating. Today only the SalesProcess
-- opportunity import (scripts/import-ghl-opportunities.ts) writes it, as
-- 'ghl-opp:<opportunity id>'. Same shape as touchpoint.external_ref (009 §8):
-- NULL for every deal made in the CRM, unique where set, insert with
-- ON CONFLICT DO NOTHING.
--
-- Also seeds the lost reason `imported_unknown`: a deal the import brings in
-- already lost (Closed Lost / lost / abandoned in SalesProcess) needs a reason
-- (CHECK stage <> 'lost' OR lost_reason_id IS NOT NULL) and SalesProcess gives
-- none. Inactive, so staff never pick it for a CRM deal.
--
-- No backfill, nothing rewritten. Re-running is harmless (IF NOT EXISTS,
-- ON CONFLICT). Owner: Shawn (approved 5 Nov 2026, cutover plan WP4).
-- =============================================================================

BEGIN;

ALTER TABLE deal ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS deal_external_ref_uq ON deal (external_ref)
  WHERE external_ref IS NOT NULL;

INSERT INTO lost_reason (code, label_en, sort_order, is_active)
VALUES ('imported_unknown', 'Imported: reason unknown', 900, false)
ON CONFLICT (code) DO NOTHING;

COMMIT;
