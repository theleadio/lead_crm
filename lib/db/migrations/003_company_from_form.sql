-- =============================================================================
-- LEAD CRM — migration 003
-- What the lead form's companyName does (spec 8.2, 9.2, 12.2).
-- 1. normalise_company_name(): one rule for "same company name"
-- 2. company.name_norm (generated) and person.company_name_given
-- 3. link_company_from_form(): keep the typed text; link to a company only
--    when exactly one existing company matches. Never creates a company.
-- 4. erase_person() also clears company_name_given
-- Owner: Shawn. 24 Sep 2026.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Normalised company name
--    lowercase; "(M)" / "(Malaysia)" and 有限公司 removed; punctuation and
--    spaces removed; the words sdn, bhd, berhad, plt removed.
--    "Acme (M) Sdn. Bhd." = "ACME SDN BHD" = "Acme Berhad" = 'acme'.
--    Placeholder answers (N/A, none, self-employed, student ...) give NULL.
--    Changing this function later does not recompute company.name_norm on
--    its own: re-run UPDATE company SET legal_name = legal_name after a change.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalise_company_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n IN ('na', 'nil', 'none', 'self', 'selfemployed', 'student',
                         'freelance', 'freelancer', 'unemployed', 'retired',
                         'notapplicable', 'personal', 'private', 'nocompany')
              THEN NULL ELSE n END
  FROM (
    SELECT nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce(p_name, '')), '\((m|malaysia)\)|有限公司', ' ', 'g'),
          '[[:punct:][:space:]]+', ' ', 'g'),
        '\m(sdn|bhd|berhad|plt)\M', ' ', 'g'),
      '\s+', '', 'g'), '') AS n
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- 2. Columns
-- -----------------------------------------------------------------------------
ALTER TABLE company
  ADD COLUMN name_norm text GENERATED ALWAYS AS (normalise_company_name(legal_name)) STORED;
CREATE INDEX company_name_norm_idx ON company (name_norm) WHERE deleted_at IS NULL;

-- What the person typed on the latest public form. Shown on 9.2 next to the
-- company picker until someone links a company. Not the source of truth.
ALTER TABLE person
  ADD COLUMN company_name_given text CHECK (char_length(company_name_given) <= 200);

-- -----------------------------------------------------------------------------
-- 3. link_company_from_form(person, typed name) returns the company id it
--    linked, or NULL. Called by POST /api/public/leads and /register inside
--    their transaction, after the person is found or created.
--      * Blank input: nothing changes.
--      * Always stores the trimmed text in person.company_name_given.
--      * Person already has a current membership: no new link (a form is not
--        a reason to move someone between companies).
--      * Exactly one live company with the same normalised name: adds a
--        current membership (no HR/billing flags).
--      * No match, several matches, or a placeholder answer: no link.
--    It never creates a company.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION link_company_from_form(p_person uuid, p_company_name text)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_text    text := left(btrim(p_company_name), 200);
  v_norm    text;
  v_ids     uuid[];
BEGIN
  IF coalesce(v_text, '') = '' THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM person
  WHERE id = p_person AND merged_into_id IS NULL AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_company_blocked: person not found, merged or deleted';
  END IF;

  UPDATE person SET company_name_given = v_text WHERE id = p_person;

  IF EXISTS (SELECT 1 FROM company_membership m JOIN company c ON c.id = m.company_id
             WHERE m.person_id = p_person AND m.end_date IS NULL AND c.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;

  v_norm := normalise_company_name(v_text);
  IF v_norm IS NULL THEN
    RETURN NULL;
  END IF;

  v_ids := ARRAY(SELECT id FROM company WHERE name_norm = v_norm AND deleted_at IS NULL LIMIT 2);
  IF cardinality(v_ids) <> 1 THEN
    RETURN NULL;
  END IF;

  INSERT INTO company_membership (person_id, company_id, start_date)
  VALUES (p_person, v_ids[1], current_date)
  ON CONFLICT DO NOTHING;
  RETURN v_ids[1];
END $$;

-- -----------------------------------------------------------------------------
-- 4. erase_person(): same as 002, plus company_name_given.
-- -----------------------------------------------------------------------------
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
  UPDATE enquiry     SET summary = NULL WHERE person_id = ANY(v_ids);
  UPDATE task        SET notes = NULL WHERE person_id = ANY(v_ids) OR related_person_id = ANY(v_ids);
  UPDATE company_membership SET job_title = NULL WHERE person_id = ANY(v_ids);
  DELETE FROM person_tag WHERE person_id = ANY(v_ids);

  INSERT INTO audit_log (user_id, action, entity, entity_id, before, after, created_by)
  VALUES (p_actor, 'erase', 'person', p_person, NULL,
          jsonb_build_object('reason', p_reason, 'merged_records_erased', cardinality(v_ids) - 1),
          p_actor);
END $$;

-- -----------------------------------------------------------------------------
-- 5. Privileges, as in 002. normalise_company_name stays callable: it reads
--    nothing and changes nothing, and the app uses it for the soft match.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION link_company_from_form(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text)    FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION link_company_from_form(uuid, text) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
