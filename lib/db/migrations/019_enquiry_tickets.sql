-- =============================================================================
-- LEAD CRM — migration 019
-- One support queue: the lead_sales tickets and inbox move into the CRM and
-- become part of `enquiry` (decided 11 Nov: tickets and enquiries live in the
-- CRM only; lead_sales drops its own copy).
--
-- What the ticket design (lead_sales docs/specs/2026-11-04-inbox-tickets-
-- design.md) brings to `enquiry`:
--   - teams (Finance, Tech, Operations, Support, Sales) and their members.
--     A team decides who sees and works an enquiry; Finance is `restricted`
--     because its enquiries can hold invoice data.
--   - categories become rows (`enquiry_category`) instead of a CHECK, each
--     with the team it routes to, Chinese label and suggestion keywords. The
--     ten §5 categories are kept with their codes, so nothing stored changes.
--   - routing rules (`enquiry_rule`), round-robin assignment inside a team.
--   - a first-reply deadline, `sla_due_at`: the same time on the next working
--     day, office hours Mon–Fri 08:30–16:30 Malaysia time, not counting the
--     `holiday` table. The app computes it (lib/enquiries/deadline.ts).
--   - `waiting_customer` status; human number (E-000123); subject; priority;
--     a link to the enquiry it follows on from.
--   - conversations and their messages (`conversation`,
--     `conversation_message`): the inbox. Unlike `message_log` (metadata
--     only, O2) these keep the text, as the inbox has to show it; erase
--     clears it.
--   - `enquiry_event`: append-only history and internal notes.
--
-- `enquiry.team_id` is filled by a trigger when a writer leaves it empty (the
-- category's team, else the default team), so existing INSERTs keep working.
--
-- erase_person() and merge_person() are re-created to cover the new tables.
-- Their bodies are the current ones (018 and 002) unchanged except for the
-- lines marked `-- 019`.
--
-- Re-running is harmless. Owner: Shawn. 11 Nov 2026.
-- =============================================================================

BEGIN;

-- ---- Teams --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text NOT NULL,
  -- Exactly one team takes what no category or rule claims.
  is_default  boolean NOT NULL DEFAULT false,
  -- Only the team itself, super_admin and management may open a restricted
  -- team's enquiries.
  restricted  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS team_one_default ON team (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS team_member (
  team_id           uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES app_user(id),
  -- Round robin gives the next enquiry to whoever was given one longest ago.
  last_assigned_at  timestamptz,
  -- clock_timestamp(): members added in one transaction keep their order.
  added_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_member_by_user ON team_member (user_id);

-- Members (Finance: Mischa, Tech: JM, Operations: Qi En; Support and Sales to
-- be named) are added in Settings by their app_user accounts.
INSERT INTO team (code, name, is_default, restricted) VALUES
  ('finance',    'Finance',    false, true),
  ('tech',       'Tech',       false, false),
  ('operations', 'Operations', false, false),
  ('sales',      'Sales',      false, false),
  ('support',    'Support',    true,  false)
ON CONFLICT (code) DO NOTHING;

-- ---- Categories and rules -----------------------------------------------------

CREATE TABLE IF NOT EXISTS enquiry_category (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label_en  text NOT NULL,
  label_zh  text,
  team_id   uuid NOT NULL REFERENCES team(id),
  -- Words that suggest this category for a message. They only suggest.
  keywords  text[] NOT NULL DEFAULT '{}',
  active    boolean NOT NULL DEFAULT true,
  position  integer NOT NULL DEFAULT 100
);

-- The ten §5 categories keep their codes. The team for each is a starting
-- point, changed in Settings. The Chinese labels are to be checked by
-- Marketing. `other` is the fallback and cannot be switched off (the app
-- refuses).
INSERT INTO enquiry_category (code, label_en, label_zh, team_id, keywords, position)
SELECT c.code, c.label_en, c.label_zh, t.id, c.keywords, c.position
FROM (VALUES
  ('course_info',       'Course info',        '课程信息', 'sales',   ARRAY[]::text[], 10),
  ('schedule',          'Schedule',           '课程时间', 'sales',   ARRAY[]::text[], 20),
  ('price',             'Price',              '价格',     'sales',   ARRAY[]::text[], 30),
  ('hrdc',              'HRDC',               'HRDC',     'sales',   ARRAY['hrdc']::text[], 40),
  ('corporate',         'Corporate',          '企业培训', 'sales',   ARRAY[]::text[], 50),
  ('registration_help', 'Registration help',  '报名帮助', 'sales',   ARRAY[]::text[], 60),
  ('payment_issue',     'Payment issue',      '付款问题', 'support', ARRAY[]::text[], 70),
  ('post_class',        'After the class',    '课后问题', 'support', ARRAY[]::text[], 80),
  ('complaint',         'Complaint',          '投诉',     'support', ARRAY[]::text[], 90),
  ('einvoice',          'E-invoice',          '电子发票', 'finance', ARRAY['e-invoice','einvoice','invoice','发票'], 110),
  ('receipt',           'Receipt',            '收据',     'finance', ARRAY['receipt','收据'], 120),
  ('voucher',           'Voucher',            '优惠券',   'tech',    ARRAY['voucher','coupon','优惠券'], 130),
  ('api_key',           'API key',            'API 密钥', 'tech',    ARRAY['api key','apikey','api-key'], 140),
  ('other',             'Other',              '其他',     'support', ARRAY[]::text[], 1000)
) AS c(code, label_en, label_zh, team_code, keywords, position)
JOIN team t ON t.code = c.team_code
ON CONFLICT (code) DO NOTHING;

-- Ordered; the first matching rule wins. No matching rule: the category's
-- team, round robin.
CREATE TABLE IF NOT EXISTS enquiry_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position        integer NOT NULL,
  match_channel   text,
  match_category  text REFERENCES enquiry_category(code),
  set_team_id     uuid REFERENCES team(id),
  assign_mode     text NOT NULL DEFAULT 'round_robin'
                    CHECK (assign_mode IN ('round_robin','fixed','none')),
  assign_user_id  uuid REFERENCES app_user(id),
  active          boolean NOT NULL DEFAULT true,
  CHECK (assign_mode <> 'fixed' OR assign_user_id IS NOT NULL),
  CHECK (match_channel IS NOT NULL OR match_category IS NOT NULL)
);

-- ---- Working days -------------------------------------------------------------

-- National plus KL/Selangor public holidays (decided 4 Nov). Not seeded: the
-- dates are entered in Settings each year from the official gazette.
CREATE TABLE IF NOT EXISTS holiday (
  day   date PRIMARY KEY,
  name  text NOT NULL
);

-- ---- Conversations and messages -----------------------------------------------

CREATE TABLE IF NOT EXISTS conversation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  person_id           uuid NOT NULL REFERENCES person(id),
  channel             text NOT NULL CHECK (channel IN ('whatsapp','email','messenger','instagram','web_form')),
  external_thread_id  text NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','snoozed','closed')),
  assigned_user_id    uuid REFERENCES app_user(id),
  last_message_at     timestamptz,
  -- The composer warns when the free-reply window (WhatsApp, Messenger) has
  -- closed since this.
  last_inbound_at     timestamptz,
  UNIQUE (channel, external_thread_id)
);
CREATE INDEX IF NOT EXISTS conversation_recent ON conversation (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversation_person_idx ON conversation (person_id);

CREATE TABLE IF NOT EXISTS conversation_message (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  conversation_id      uuid NOT NULL REFERENCES conversation(id),
  person_id            uuid NOT NULL REFERENCES person(id),
  channel              text NOT NULL CHECK (channel IN ('whatsapp','email','messenger','instagram','web_form')),
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  external_message_id  text,
  -- Free text about a person: erase_person() clears it.
  body                 text,
  -- Files live in storage; only their paths are kept here.
  attachment_paths     text[] NOT NULL DEFAULT '{}',
  sent_by_user_id      uuid REFERENCES app_user(id),
  sent_at              timestamptz NOT NULL DEFAULT now(),
  status               text NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received','queued','sent','delivered','read','failed')),
  UNIQUE (channel, external_message_id)
);
CREATE INDEX IF NOT EXISTS conversation_message_by_conversation
  ON conversation_message (conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS conversation_message_person_idx
  ON conversation_message (person_id);

-- ---- enquiry: the ticket fields ---------------------------------------------

CREATE SEQUENCE IF NOT EXISTS enquiry_number_seq;

ALTER TABLE enquiry
  ADD COLUMN IF NOT EXISTS number text
    DEFAULT 'E-' || lpad(nextval('enquiry_number_seq')::text, 6, '0'),
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES team(id),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversation(id),
  ADD COLUMN IF NOT EXISTS previous_enquiry_id uuid REFERENCES enquiry(id);

-- ADD COLUMN ... DEFAULT nextval() numbers the existing rows too.
UPDATE enquiry e SET team_id = coalesce(
    (SELECT c.team_id FROM enquiry_category c WHERE c.code = e.category),
    (SELECT id FROM team WHERE is_default))
  WHERE team_id IS NULL;

ALTER TABLE enquiry ALTER COLUMN number SET NOT NULL;
ALTER TABLE enquiry ALTER COLUMN team_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS enquiry_number_key ON enquiry (number);

ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_subject_check;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_subject_check
  CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200);
ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_priority_check;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_priority_check
  CHECK (priority IN ('low','normal','high'));

-- Status gains `waiting_customer` (an answer is owed by the customer).
ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_status_check;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_status_check CHECK (status IN
  ('open','waiting_customer','ai_resolved','human_resolved','converted','closed'));

-- Category: a row of enquiry_category instead of the §5 CHECK.
ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_category_check;
ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_category_fkey;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_category_fkey
  FOREIGN KEY (category) REFERENCES enquiry_category(code);

CREATE INDEX IF NOT EXISTS enquiry_open_by_team ON enquiry (team_id, sla_due_at)
  WHERE status IN ('open','waiting_customer');
CREATE INDEX IF NOT EXISTS enquiry_conversation_idx ON enquiry (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- A writer that leaves team_id empty gets the category's team, else the
-- default team. The app's routing sets it itself.
CREATE OR REPLACE FUNCTION enquiry_fill_team() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    NEW.team_id := coalesce(
      (SELECT team_id FROM enquiry_category WHERE code = NEW.category),
      (SELECT id FROM team WHERE is_default));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enquiry_fill_team ON enquiry;
CREATE TRIGGER enquiry_fill_team BEFORE INSERT ON enquiry
  FOR EACH ROW EXECUTE FUNCTION enquiry_fill_team();

-- ---- History ------------------------------------------------------------------

-- Append-only: creation, status, reassignment, category, notes, first reply.
-- `before`/`after` hold ids and codes only, never free text, because they
-- cannot be erased; the one free-text column, `note`, can be.
CREATE TABLE IF NOT EXISTS enquiry_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- clock_timestamp(): events written in one transaction keep their order.
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  enquiry_id  uuid NOT NULL REFERENCES enquiry(id),
  user_id     uuid REFERENCES app_user(id),
  kind        text NOT NULL CHECK (kind IN ('created','status','assigned','category','note','first_response')),
  before      jsonb,
  after       jsonb,
  note        text CHECK (note IS NULL OR length(note) <= 5000)
);
CREATE INDEX IF NOT EXISTS enquiry_event_by_enquiry ON enquiry_event (enquiry_id, created_at);

-- No DELETE, and the only UPDATE allowed is clearing `note` (erase_person).
CREATE OR REPLACE FUNCTION enquiry_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.note IS NULL
     AND (NEW.id, NEW.created_at, NEW.enquiry_id, NEW.user_id, NEW.kind, NEW.before, NEW.after)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.created_at, OLD.enquiry_id, OLD.user_id, OLD.kind, OLD.before, OLD.after)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enquiry_event is append-only';
END $$;
DROP TRIGGER IF EXISTS enquiry_event_append_only ON enquiry_event;
CREATE TRIGGER enquiry_event_append_only
  BEFORE UPDATE OR DELETE ON enquiry_event
  FOR EACH ROW EXECUTE FUNCTION enquiry_event_append_only();

-- ---- merge_person(): 002's body, plus the conversations -----------------------

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
  -- 019: the inbox moves with the person.
  UPDATE conversation SET person_id = p_target WHERE person_id = p_source;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('conversations', v_n);
  UPDATE conversation_message SET person_id = p_target WHERE person_id = p_source;

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


REVOKE EXECUTE ON FUNCTION merge_person(uuid, uuid, uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION merge_person(uuid, uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ---- erase_person(): 018's body, plus the inbox text and notes ----------------

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
  UPDATE enquiry     SET summary = NULL, resolution = NULL, subject = NULL WHERE person_id = ANY(v_ids); -- 019: subject
  -- 019: inbox text, attachment paths and enquiry notes.
  UPDATE conversation_message SET body = NULL, attachment_paths = '{}' WHERE person_id = ANY(v_ids);
  UPDATE enquiry_event SET note = NULL
  WHERE note IS NOT NULL
    AND enquiry_id IN (SELECT id FROM enquiry WHERE person_id = ANY(v_ids));
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
