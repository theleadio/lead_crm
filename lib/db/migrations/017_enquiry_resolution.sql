-- =============================================================================
-- LEAD CRM — migration 017
-- enquiry.resolution: the outcome note written when support closes an enquiry
-- (§9.13; PR #48, open question 3).
--
-- Until now the close note was going to be written to `summary`, which holds
-- the enquiry's short summary (§5), so closing would replace it. The note gets
-- its own column instead.
--
-- Nullable text, no default, no backfill (no enquiry has been closed through
-- the screen yet), no index (nothing searches by it). The API caps the note at
-- 2,000 characters (lib/validation/enquiry.ts); like `summary`, the database
-- sets no limit. The row-version trigger (005) is column-agnostic, so a change
-- to `resolution` bumps `version` like any other.
--
-- The note is free text about a person, so erase_person() must clear it, as it
-- clears `summary`. CREATE OR REPLACE below is migration 003's body unchanged
-- except for `resolution = NULL` on the enquiry line; privileges are re-applied
-- as 003 did. Do not put the note's text in audit_log: that table is
-- append-only, so anything written there can never be erased.
--
-- Re-running is harmless. Owner: Shawn. 6 Nov 2026.
-- =============================================================================

BEGIN;

ALTER TABLE enquiry ADD COLUMN IF NOT EXISTS resolution text;

CREATE OR REPLACE FUNCTION erase_person(p_person uuid, p_actor uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_row person%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF p_actor IS NULL OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'erase_blocked: actor and reason are required';
  END IF;

  SELECT * INTO v_row FROM person WHERE id = p_person FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'erase_blocked: person not found';
  END IF;
  IF v_row.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'erase_blocked: already erased';
  END IF;
  IF v_row.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'erase_blocked: this record was merged; erase the kept person instead';
  END IF;

  -- This person plus every record merged into them (merges never chain).
  v_ids := ARRAY(SELECT id FROM person WHERE id = p_person OR merged_into_id = p_person);
  PERFORM 1 FROM person WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  UPDATE person SET
    full_name           = 'Erased person',
    preferred_name      = NULL,
    email               = NULL,
    phone               = NULL,
    phone_e164          = NULL,
    whatsapp_e164       = NULL,
    job_title           = NULL,
    notes               = NULL,
    wati_contact_id     = NULL,
    stripe_customer_id  = NULL,
    company_name_given  = NULL,
    needs_review        = false,
    needs_review_reason = NULL,
    erased_at           = now(),
    deleted_at          = coalesce(deleted_at, now())
  WHERE id = ANY(v_ids);

  UPDATE message_log SET body = NULL WHERE person_id = ANY(v_ids);
  UPDATE enquiry     SET summary = NULL, resolution = NULL WHERE person_id = ANY(v_ids);
  UPDATE task        SET notes = NULL WHERE person_id = ANY(v_ids) OR related_person_id = ANY(v_ids);
  UPDATE company_membership SET job_title = NULL WHERE person_id = ANY(v_ids);
  DELETE FROM person_tag WHERE person_id = ANY(v_ids);

  INSERT INTO audit_log (user_id, action, entity, entity_id, before, after, created_by)
  VALUES (p_actor, 'erase', 'person', p_person, NULL,
          jsonb_build_object('reason', p_reason, 'merged_records_erased', cardinality(v_ids) - 1),
          p_actor);
END $$;

REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
