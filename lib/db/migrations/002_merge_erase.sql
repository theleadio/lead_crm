-- =============================================================================
-- LEAD CRM — migration 002
-- 1. person.needs_review_reason (+ erased_at)
-- 2. A narrow exception to the append-only rule so a merge can re-point
--    touchpoint and consent rows to the kept person
-- 3. merge_person(), erase_person(), soft_delete_person()
-- 4. EXECUTE on those functions revoked from PUBLIC (and Supabase anon/authenticated)
-- Agreed with Zixuan 24 Sep 2026. Owner: Shawn.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
ALTER TABLE person
  ADD COLUMN needs_review_reason text CHECK (needs_review_reason IN (
    'phone_unnormalised',
    'possible_duplicate_company',
    'possible_duplicate_email',
    'possible_duplicate_phone',
    'no_name')),
  ADD COLUMN erased_at timestamptz,
  ADD CONSTRAINT person_review_reason_matches_flag
    CHECK (needs_review = (needs_review_reason IS NOT NULL));

-- -----------------------------------------------------------------------------
-- 2. Append-only, with one exception
--    Inside merge_person() only, touchpoint and consent rows may have person_id
--    (and, for touchpoints, is_first_touch) changed. Every other column stays
--    frozen and DELETE is still refused.
--
--    Guard against accidents, not against hostile code: anything that can run
--    SQL as the app role could also set the flag. That's the same trust level
--    as the rest of the database.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND TG_TABLE_NAME IN ('touchpoint', 'consent')
     AND current_setting('lead.merge_in_progress', true) = 'on'
     AND (to_jsonb(NEW) - 'person_id' - 'is_first_touch')
       = (to_jsonb(OLD) - 'person_id' - 'is_first_touch')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- -----------------------------------------------------------------------------
-- 3a. merge_person(source, target, actor)
--
--    Moves everything from source onto target and marks source as merged.
--    Call it inside the API's transaction; apply the admin's per-field choices
--    (9.3 fields map) to the target AFTER this returns — by then source is
--    marked merged, so its email/phone no longer block the unique indexes.
--
--    Refuses (SQLSTATE P0001, message starting 'merge_blocked:') when:
--      * source = target, either is missing, deleted, erased or already merged
--      * both are actively enrolled in the same class (DETAIL lists the classes)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_person(p_source uuid, p_target uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_src      person%ROWTYPE;
  v_tgt      person%ROWTYPE;
  v_clash    text;
  v_first    uuid;
  v_purpose  text;
  v_optout   boolean;
  v_counts   jsonb := '{}'::jsonb;
  v_n        integer;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'merge_blocked: actor is required';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'merge_blocked: cannot merge a person into themselves';
  END IF;

  -- Lock both rows in a fixed order so two concurrent merges can't deadlock.
  PERFORM 1 FROM person WHERE id IN (p_source, p_target) ORDER BY id FOR UPDATE;
  SELECT * INTO v_src FROM person WHERE id = p_source;
  SELECT * INTO v_tgt FROM person WHERE id = p_target;

  IF v_src.id IS NULL OR v_tgt.id IS NULL THEN
    RAISE EXCEPTION 'merge_blocked: person not found';
  END IF;
  IF v_src.merged_into_id IS NOT NULL OR v_tgt.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'merge_blocked: one of these people has already been merged';
  END IF;
  IF v_src.deleted_at IS NOT NULL OR v_tgt.deleted_at IS NOT NULL
     OR v_src.erased_at IS NOT NULL OR v_tgt.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_blocked: one of these people is deleted or erased';
  END IF;

  -- Both enrolled in the same class: the admin must resolve it first.
  SELECT string_agg(c.code, ', ' ORDER BY c.code) INTO v_clash
  FROM enrolment a
  JOIN enrolment b ON b.class_id = a.class_id
  JOIN class c ON c.id = a.class_id
  WHERE a.person_id = p_source AND b.person_id = p_target
    AND a.status NOT IN ('cancelled','refunded','transferred')
    AND b.status NOT IN ('cancelled','refunded','transferred');
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'merge_blocked: both people are enrolled in the same class'
      USING DETAIL = v_clash,
            HINT = 'Cancel or transfer one of the enrolments, then merge.';
  END IF;

  -- Record each purpose where either person's CURRENT consent is an opt-out.
  -- Any opt-out wins after the merge.
  CREATE TEMP TABLE IF NOT EXISTS _merge_optouts (purpose text PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _merge_optouts;
  INSERT INTO _merge_optouts (purpose)
    SELECT DISTINCT purpose FROM consent_current
    WHERE person_id IN (p_source, p_target) AND NOT is_granted;

  -- Earliest touchpoint across both people becomes the first touch.
  SELECT id INTO v_first FROM touchpoint
  WHERE person_id IN (p_source, p_target)
  ORDER BY occurred_at, created_at, id
  LIMIT 1;

  PERFORM set_config('lead.merge_in_progress', 'on', true);

  UPDATE touchpoint SET is_first_touch = false
    WHERE person_id IN (p_source, p_target) AND is_first_touch
      AND id IS DISTINCT FROM v_first;
  UPDATE touchpoint SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('touchpoints', v_n);
  IF v_first IS NOT NULL THEN
    UPDATE touchpoint SET is_first_touch = true WHERE id = v_first AND NOT is_first_touch;
  END IF;

  UPDATE consent SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('consents', v_n);

  PERFORM set_config('lead.merge_in_progress', 'off', true);

  -- Re-assert any opt-out that the merged history would otherwise override.
  FOR v_purpose IN SELECT purpose FROM _merge_optouts LOOP
    SELECT is_granted INTO v_optout FROM consent_current
      WHERE person_id = p_target AND purpose = v_purpose;
    IF v_optout THEN
      INSERT INTO consent (person_id, purpose, is_granted, source, created_by)
      VALUES (p_target, v_purpose, false, 'merge: opt-out carried over', p_actor);
    END IF;
  END LOOP;

  -- Ordinary tables.
  UPDATE deal SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('deals', v_n);
  UPDATE enrolment SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('enrolments', v_n);
  UPDATE enrolment SET booker_person_id = p_target WHERE booker_person_id = p_source;
  UPDATE enquiry SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('enquiries', v_n);
  UPDATE message_log SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('messages', v_n);

  -- The duplicate-review task for this exact pair is now resolved.
  UPDATE task SET done_at = now(), done_by = p_actor
  WHERE type = 'review_duplicate' AND done_at IS NULL
    AND ((person_id = p_source AND related_person_id = p_target)
      OR (person_id = p_target AND related_person_id = p_source));
  -- Leave that pair's tasks pointing where they are (moving both sides to the
  -- target would make a task about one person being a duplicate of themselves).
  UPDATE task SET person_id = p_target
  WHERE person_id = p_source
    AND NOT (type = 'review_duplicate' AND related_person_id = p_target);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);
  UPDATE task SET related_person_id = p_target
  WHERE related_person_id = p_source
    AND NOT (type = 'review_duplicate' AND person_id = p_target);

  -- Tags: keep one copy of each.
  INSERT INTO person_tag (person_id, tag_id, tagged_at, tagged_by)
    SELECT p_target, tag_id, tagged_at, tagged_by FROM person_tag WHERE person_id = p_source
    ON CONFLICT (person_id, tag_id) DO NOTHING;
  DELETE FROM person_tag WHERE person_id = p_source;

  -- Company memberships: the target's current membership at a company wins;
  -- a source duplicate at the same company is dropped, the rest move.
  DELETE FROM company_membership s
  WHERE s.person_id = p_source AND s.end_date IS NULL
    AND EXISTS (SELECT 1 FROM company_membership t
                WHERE t.person_id = p_target AND t.company_id = s.company_id AND t.end_date IS NULL);
  UPDATE company_membership SET person_id = p_target WHERE person_id = p_source;

  -- Earlier merges into the source now point at the target (no chains).
  UPDATE person SET merged_into_id = p_target WHERE merged_into_id = p_source;

  UPDATE person SET
    first_touchpoint_id = coalesce(v_first, first_touchpoint_id),
    last_activity_at    = greatest(v_src.last_activity_at, v_tgt.last_activity_at)
  WHERE id = p_target;

  UPDATE person SET merged_into_id = p_target WHERE id = p_source;

  INSERT INTO audit_log (user_id, action, entity, entity_id, before, after, created_by)
  VALUES (p_actor, 'merge', 'person', p_target,
          jsonb_build_object('source_id', p_source, 'target_id', p_target),
          v_counts, p_actor);

  RETURN v_counts || jsonb_build_object('first_touchpoint_id', v_first);
END $$;

-- -----------------------------------------------------------------------------
-- 3b. erase_person(person, actor, reason)  — PDPA erasure = anonymise
--    Clears personal details, keeps the row so deals, enrolments and payments
--    stay intact for accounting. Touchpoint and consent rows are kept:
--    touchpoints hold campaign data, consent is the record of an opt-out.
--    Records previously merged into this person are anonymised too — they
--    still hold the old name/email/phone.
--    The erasure's own audit row stores no personal data.
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
-- 3c. soft_delete_person(person, actor, reason)
--    For test data and records added by mistake. Refused for anyone with a
--    payment or enrolment — those can only be erased (anonymised).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_person(p_person uuid, p_actor uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_row person%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'delete_blocked: actor and reason are required';
  END IF;

  SELECT * INTO v_row FROM person WHERE id = p_person FOR UPDATE;
  IF v_row.id IS NULL OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'delete_blocked: person not found or already deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM enrolment WHERE person_id = p_person)
     OR EXISTS (SELECT 1 FROM payment p JOIN enrolment e ON e.id = p.enrolment_id WHERE e.person_id = p_person)
     OR EXISTS (SELECT 1 FROM payment p JOIN deal d ON d.id = p.deal_id WHERE d.person_id = p_person) THEN
    RAISE EXCEPTION 'delete_blocked: this person has enrolments or payments; use erase instead';
  END IF;

  UPDATE person SET deleted_at = now() WHERE id = p_person;

  INSERT INTO audit_log (user_id, action, entity, entity_id, before, after, created_by)
  -- No row snapshot: audit_log is append-only, so personal data written
  -- here could never be erased later.
  VALUES (p_actor, 'soft_delete', 'person', p_person, NULL,
          jsonb_build_object('reason', p_reason), p_actor);
END $$;

-- -----------------------------------------------------------------------------
-- 4. Only the app's server connection may call these functions.
--    Postgres grants EXECUTE to PUBLIC by default, and Supabase also grants it
--    to anon/authenticated, which would let anyone holding the publishable key
--    call them through the Data API. The app connects via DATABASE_URL as the
--    owner, so it keeps access. p_actor is trusted: the app must pass the
--    signed-in user's id from the session, never a value from the request body.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION merge_person(uuid, uuid, uuid)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION soft_delete_person(uuid, uuid, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION merge_person(uuid, uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION erase_person(uuid, uuid, text) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION soft_delete_person(uuid, uuid, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
