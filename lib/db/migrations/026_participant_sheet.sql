-- =============================================================================
-- 026 — LEAD Participant List (Google Sheet) sync
--
-- Some signups only live in the ops team's Google Sheet "LEAD Participant List
-- 2026". An Apps Script in the sheet pushes its rows to
-- POST /api/sync/participants (own server-only key), and the weekly ads report
-- counts them as signups (docs/superpowers/notes/2026-11-18-weekly-ads-report-proposal.md).
--
-- 1. participant_class_label: one row per sheet label and class date, e.g.
--    "n8n: 11-12 nov" on 2026-11-11. The date is the start day read from the
--    label, with the year worked out from the row's order (the sheet lists
--    newest first). class_id is the CRM class it was matched to, or NULL while
--    unmatched; source says whether the sync matched it (auto) or a person did
--    (manual). Unmatched labels are listed in the report so someone can map
--    them (`npm run participants:map`).
--
-- 2. participant_entry: one row per person and label, insert-only.
--    first_seen_at is the signup date: the hour the row first reached the CRM
--    (ops add a row when someone signs up). approx_date is true for rows loaded
--    by the one-off history backfill, whose date is the class start date
--    instead, so a report can say a week is approximate.
--
-- Merged people: entries stay on the merged-away person; the report follows
-- person.merged_into_id, so merge_person() needs no change.
--
-- Not reachable from the browser: privileges revoked from anon/authenticated.
-- Re-running is harmless.
--
-- Rollback:
--   DROP TABLE participant_entry;
--   DROP TABLE participant_class_label;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS participant_class_label (
  label_norm  text        NOT NULL CHECK (btrim(label_norm) <> ''),
  class_date  date        NOT NULL,
  raw_label   text        NOT NULL,
  class_id    uuid        REFERENCES class(id) ON DELETE SET NULL,
  source      text        NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (label_norm, class_date)
);

CREATE TABLE IF NOT EXISTS participant_entry (
  person_id      uuid        NOT NULL REFERENCES person(id),
  label_norm     text        NOT NULL,
  class_date     date        NOT NULL,
  hrdc           boolean     NOT NULL DEFAULT false,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  approx_date    boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (person_id, label_norm, class_date),
  FOREIGN KEY (label_norm, class_date)
    REFERENCES participant_class_label (label_norm, class_date)
);
CREATE INDEX IF NOT EXISTS participant_entry_seen_idx
  ON participant_entry (first_seen_at);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON participant_class_label FROM %I', r);
      EXECUTE format('REVOKE ALL ON participant_entry FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
