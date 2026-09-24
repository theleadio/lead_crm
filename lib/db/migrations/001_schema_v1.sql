-- =============================================================================
-- LEAD CRM — schema v1 (draft for Zixuan)
-- Source: Software Specification v1.2, Section 5 + changes of 22–24 Sep 2026.
-- Target: PostgreSQL 15+ (tested on 16). Owner: Shawn.
--
-- Conventions (Spec Section 4):
--   * uuid primary keys, timestamptz in UTC, money numeric(12,2) MYR
--   * enums are text + CHECK (easier to extend than native enum types)
--   * every table: id, created_at, updated_at, created_by
--   * soft delete via deleted_at where records are user-facing
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search on names

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Append-only tables reject UPDATE and DELETE outright.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- =============================================================================
-- Users and settings
-- =============================================================================

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id),
  auth_user_id    text UNIQUE,                                   -- v1.2: link to auth provider user
  email           text NOT NULL,
  full_name       text NOT NULL,
  role_code       text NOT NULL CHECK (role_code IN
                    ('super_admin','management','marketing','sales','support','operations','part_time')),
  is_active       boolean NOT NULL DEFAULT true,
  employment_type text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time')),
  last_login_at   timestamptz
);
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email));

CREATE TABLE app_setting (                                       -- v1.2
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  updated_by  uuid REFERENCES app_user(id)
);

-- =============================================================================
-- People and companies
-- =============================================================================

CREATE TABLE person (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(id),
  full_name           text NOT NULL CHECK (btrim(full_name) <> ''),
  preferred_name      text,
  email               text,
  -- Generated so it can never drift from email. The app does not write it.
  email_norm          text GENERATED ALWAYS AS (nullif(lower(btrim(email)), '')) STORED,
  phone               text,
  phone_e164          text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),  -- normalised by the app (libphonenumber)
  whatsapp_e164       text CHECK (whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  preferred_language  text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','zh')),
  job_title           text,
  owner_user_id       uuid REFERENCES app_user(id),
  first_touchpoint_id uuid,                                      -- FK added after touchpoint exists
  wati_contact_id     text,
  stripe_customer_id  text,
  needs_review        boolean NOT NULL DEFAULT false,
  merged_into_id      uuid REFERENCES person(id),
  last_activity_at    timestamptz,                               -- Spec 12.9
  notes               text,
  deleted_at          timestamptz,
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);
-- Uniqueness ignores deleted and merged-away rows, so a merge can keep the survivor's values.
CREATE UNIQUE INDEX person_email_norm_uq ON person (email_norm)
  WHERE email_norm IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL;
CREATE UNIQUE INDEX person_phone_e164_uq ON person (phone_e164)
  WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL;
CREATE INDEX person_owner_idx ON person (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX person_name_trgm_idx ON person USING gin (full_name gin_trgm_ops);
CREATE INDEX person_last_activity_idx ON person (last_activity_at DESC NULLS LAST);
CREATE INDEX person_needs_review_idx ON person (id) WHERE needs_review AND deleted_at IS NULL;

CREATE TABLE company (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES app_user(id),
  legal_name       text NOT NULL CHECK (btrim(legal_name) <> ''),
  registration_no  text,
  industry         text,
  size_band        text,
  hrdc_registered  boolean NOT NULL DEFAULT false,
  billing_address  text,
  billing_email    text,
  owner_user_id    uuid REFERENCES app_user(id),
  deleted_at       timestamptz
);
CREATE INDEX company_name_trgm_idx ON company USING gin (legal_name gin_trgm_ops);

CREATE TABLE company_membership (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(id),
  person_id           uuid NOT NULL REFERENCES person(id),
  company_id          uuid NOT NULL REFERENCES company(id),
  job_title           text,
  is_hr_contact       boolean NOT NULL DEFAULT false,
  is_billing_contact  boolean NOT NULL DEFAULT false,
  start_date          date,
  end_date            date,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX company_membership_current_uq ON company_membership (person_id, company_id)
  WHERE end_date IS NULL;
CREATE INDEX company_membership_company_idx ON company_membership (company_id);

CREATE TABLE tag (                                               -- v1.1
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  colour      text,
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX tag_name_uq ON tag (lower(name));

CREATE TABLE person_tag (
  person_id  uuid NOT NULL REFERENCES person(id),
  tag_id     uuid NOT NULL REFERENCES tag(id),
  tagged_at  timestamptz NOT NULL DEFAULT now(),
  tagged_by  uuid REFERENCES app_user(id),
  PRIMARY KEY (person_id, tag_id)
);
CREATE INDEX person_tag_tag_idx ON person_tag (tag_id);

-- =============================================================================
-- Attribution (append-only)
-- =============================================================================

CREATE TABLE touchpoint (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id),
  person_id       uuid NOT NULL REFERENCES person(id),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  channel         text NOT NULL CHECK (channel IN
                    ('web_form','whatsapp','ctwa','lead_form','walk_in','referral','payment_link','import')),
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  gclid           text,
  fbclid          text,
  ctwa_clid       text,
  landing_url     text,
  referrer        text,
  form_name       text,
  is_first_touch  boolean NOT NULL DEFAULT false
);
CREATE INDEX touchpoint_person_time_idx ON touchpoint (person_id, occurred_at);
CREATE INDEX touchpoint_campaign_idx ON touchpoint (utm_campaign);
-- At most one first touch per person.
CREATE UNIQUE INDEX touchpoint_first_touch_uq ON touchpoint (person_id) WHERE is_first_touch;
CREATE TRIGGER touchpoint_append_only BEFORE UPDATE OR DELETE ON touchpoint
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE person
  ADD CONSTRAINT person_first_touchpoint_fk FOREIGN KEY (first_touchpoint_id) REFERENCES touchpoint(id);

-- =============================================================================
-- Catalogue and scheduling
-- =============================================================================

CREATE TABLE course (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id),
  code            text NOT NULL UNIQUE,
  name_en         text NOT NULL,
  name_zh         text,
  track           text NOT NULL CHECK (track IN
                    ('certification','mastery','masterclass','workshop','conference','corporate')),
  duration_days   integer NOT NULL CHECK (duration_days > 0),
  list_price_myr  numeric(12,2) CHECK (list_price_myr >= 0),
  hrdc_claimable  boolean NOT NULL DEFAULT false,
  description_en  text,
  description_zh  text,
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE class (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES app_user(id),
  course_id            uuid NOT NULL REFERENCES course(id),
  code                 text NOT NULL UNIQUE,
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  start_time           time,
  end_time             time,
  language             text NOT NULL CHECK (language IN ('en','zh')),
  mode                 text NOT NULL CHECK (mode IN ('in_person','online','hybrid')),
  venue_name           text,
  venue_address        text,
  city                 text,
  online_url           text,
  capacity             integer NOT NULL CHECK (capacity > 0),
  few_seats_threshold  integer NOT NULL DEFAULT 5 CHECK (few_seats_threshold >= 0),
  price_myr            numeric(12,2) CHECK (price_myr >= 0),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN
                         ('draft','open','few_seats','full','cancelled','completed')),
  is_public            boolean NOT NULL DEFAULT false,
  trainer_user_ids     uuid[] NOT NULL DEFAULT '{}',
  hrdc_claimable       boolean NOT NULL DEFAULT false,
  CHECK (end_date >= start_date),
  CHECK (mode = 'online'    OR (venue_name IS NOT NULL AND venue_address IS NOT NULL AND city IS NOT NULL)),
  CHECK (mode = 'in_person' OR online_url IS NOT NULL)
);
CREATE INDEX class_public_schedule_idx ON class (start_date, is_public, status);
CREATE INDEX class_course_idx ON class (course_id);

CREATE TABLE class_notice (                                      -- v1.1
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES app_user(id),
  class_id         uuid NOT NULL REFERENCES class(id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','discarded')),
  changed_fields   jsonb NOT NULL,
  message_en       text,
  message_zh       text,
  recipient_count  integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  approved_by      uuid REFERENCES app_user(id),
  approved_at      timestamptz,
  sent_at          timestamptz,
  send_error       text,
  CHECK ((status IN ('approved','sent')) = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
-- Spec: only one pending notice per class at a time.
CREATE UNIQUE INDEX class_notice_one_pending_uq ON class_notice (class_id) WHERE status = 'pending';

-- =============================================================================
-- Sales
-- =============================================================================

CREATE TABLE lost_reason (                                       -- v1.1, replaces the enum
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  code        text NOT NULL UNIQUE,
  label_en    text NOT NULL,
  label_zh    text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE deal (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES app_user(id),
  pipeline             text NOT NULL CHECK (pipeline IN ('individual','corporate')),
  stage                text NOT NULL,
  person_id            uuid NOT NULL REFERENCES person(id),
  company_id           uuid REFERENCES company(id),
  course_id            uuid REFERENCES course(id),
  class_id             uuid REFERENCES class(id),
  headcount            integer CHECK (headcount > 0),
  amount_myr           numeric(12,2) CHECK (amount_myr >= 0),
  funding_type         text CHECK (funding_type IN ('self','company','hrdc','other')),
  hrdc_grant_ref       text,
  hrdc_approval_date   date,
  hrdc_deadline_date   date,
  lost_reason_id       uuid REFERENCES lost_reason(id),
  owner_user_id        uuid REFERENCES app_user(id),
  won_at               timestamptz,
  lost_at              timestamptz,
  stage_changed_at     timestamptz NOT NULL DEFAULT now(),
  checkout_url         text,                                     -- v1.2
  checkout_session_id  text,                                     -- v1.2
  checkout_sent_at     timestamptz,                              -- v1.2
  deleted_at           timestamptz,
  -- Stage must belong to the deal's pipeline (Spec 12.5).
  CHECK (
    (pipeline = 'individual' AND stage IN ('new','engaged','qualified','checkout_sent','won','lost')) OR
    (pipeline = 'corporate'  AND stage IN ('new','discovery','proposal_sent','funding','won','lost'))
  ),
  CHECK (stage <> 'lost' OR lost_reason_id IS NOT NULL),
  CHECK (stage <> 'won'  OR won_at  IS NOT NULL),
  CHECK (stage <> 'lost' OR lost_at IS NOT NULL),
  -- Corporate deals past discovery need company, headcount and funding type (Spec 12.5).
  CHECK (pipeline <> 'corporate' OR stage IN ('new','discovery','lost')
         OR (company_id IS NOT NULL AND headcount IS NOT NULL AND funding_type IS NOT NULL))
);
CREATE INDEX deal_board_idx ON deal (pipeline, stage) WHERE deleted_at IS NULL;
CREATE INDEX deal_owner_idx ON deal (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_person_idx ON deal (person_id);

CREATE TABLE deal_stage_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  deal_id     uuid NOT NULL REFERENCES deal(id),
  from_stage  text,
  to_stage    text NOT NULL,
  changed_by  uuid REFERENCES app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_history_deal_idx ON deal_stage_history (deal_id, changed_at);
CREATE TRIGGER deal_stage_history_append_only BEFORE UPDATE OR DELETE ON deal_stage_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- =============================================================================
-- Operations
-- =============================================================================

CREATE TABLE enrolment (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid REFERENCES app_user(id),
  person_id                    uuid NOT NULL REFERENCES person(id),
  class_id                     uuid NOT NULL REFERENCES class(id),
  deal_id                      uuid REFERENCES deal(id),
  booker_person_id             uuid REFERENCES person(id),
  status                       text NOT NULL DEFAULT 'reserved' CHECK (status IN
                                 ('reserved','payment_pending','waitlisted','confirmed','onboarded',
                                  'attended','completed','no_show','transferred','cancelled','refunded')),
  payer_type                   text NOT NULL DEFAULT 'self' CHECK (payer_type IN ('self','company')),
  seat_reserved_until          timestamptz,
  onboarding_step              integer NOT NULL DEFAULT 0 CHECK (onboarding_step >= 0),
  price_paid_myr               numeric(12,2) CHECK (price_paid_myr >= 0),
  certificate_no               text UNIQUE,
  completed_at                 timestamptz,
  cancelled_reason             text,
  transferred_to_enrolment_id  uuid REFERENCES enrolment(id),
  CHECK (status <> 'transferred' OR transferred_to_enrolment_id IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
-- No double-booking. Cancelled, refunded and transferred-away rows don't count,
-- so a person can re-book a class they left.
CREATE UNIQUE INDEX enrolment_person_class_active_uq ON enrolment (person_id, class_id)
  WHERE status NOT IN ('cancelled','refunded','transferred');
CREATE INDEX enrolment_class_status_idx ON enrolment (class_id, status);
CREATE INDEX enrolment_person_idx ON enrolment (person_id);

CREATE TABLE payment (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES app_user(id),
  enrolment_id                uuid REFERENCES enrolment(id),
  deal_id                     uuid REFERENCES deal(id),
  match_status                text NOT NULL DEFAULT 'matched' CHECK (match_status IN ('matched','unmatched')),  -- v1.2
  method                      text NOT NULL CHECK (method IN
                                ('stripe_card','stripe_fpx','bank_transfer','hrdc','invoice')),
  status                      text NOT NULL CHECK (status IN
                                ('pending','succeeded','failed','refunded','partially_refunded')),
  amount_myr                  numeric(12,2) NOT NULL CHECK (amount_myr > 0),
  currency                    text NOT NULL DEFAULT 'MYR' CHECK (currency = 'MYR'),
  stripe_payment_intent_id    text,
  stripe_checkout_session_id  text,
  reference_no                text,
  proof_file_key              text,
  paid_at                     timestamptz,
  refunded_amount_myr         numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount_myr >= 0),
  notes                       text,                              -- v1.1
  recorded_by                 uuid REFERENCES app_user(id),
  CHECK (refunded_amount_myr <= amount_myr),
  -- Linked to something, unless it is an unmatched Stripe payment awaiting 11.3.
  CHECK (match_status = 'unmatched' OR enrolment_id IS NOT NULL OR deal_id IS NOT NULL),
  CHECK (match_status = 'matched' OR method IN ('stripe_card','stripe_fpx')),
  -- Manual payments need a reference and proof (Spec 9.12).
  CHECK (method NOT IN ('bank_transfer','hrdc','invoice')
         OR (reference_no IS NOT NULL AND proof_file_key IS NOT NULL))
);
CREATE UNIQUE INDEX payment_stripe_intent_uq ON payment (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX payment_enrolment_idx ON payment (enrolment_id);
CREATE INDEX payment_deal_idx ON payment (deal_id);
CREATE INDEX payment_unmatched_idx ON payment (created_at) WHERE match_status = 'unmatched';

-- =============================================================================
-- Support, tasks, consent
-- =============================================================================

CREATE TABLE enquiry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES app_user(id),
  person_id             uuid NOT NULL REFERENCES person(id),
  channel               text NOT NULL,
  category              text CHECK (category IN
                          ('course_info','schedule','price','hrdc','corporate','registration_help',
                           'payment_issue','post_class','complaint','other')),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN
                          ('open','ai_resolved','human_resolved','converted','closed')),
  handled_by            text CHECK (handled_by IN ('ai','user')),
  assigned_user_id      uuid REFERENCES app_user(id),
  wati_conversation_id  text,
  first_message_at      timestamptz,
  first_response_at     timestamptz,
  closed_at             timestamptz,
  deal_id               uuid REFERENCES deal(id),
  summary               text,
  CHECK (status <> 'converted' OR deal_id IS NOT NULL)
);
CREATE INDEX enquiry_queue_idx ON enquiry (status, first_message_at);
CREATE INDEX enquiry_assigned_idx ON enquiry (assigned_user_id) WHERE status = 'open';
CREATE INDEX enquiry_person_idx ON enquiry (person_id);

CREATE TABLE task (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES app_user(id),
  type               text NOT NULL CHECK (type IN
                       ('call','follow_up','review_duplicate','match_payment','hrdc_deadline',
                        'export_request','other')),
  title              text NOT NULL,
  person_id          uuid REFERENCES person(id),
  related_person_id  uuid REFERENCES person(id),                 -- v1.2
  deal_id            uuid REFERENCES deal(id),
  enrolment_id       uuid REFERENCES enrolment(id),
  assigned_user_id   uuid REFERENCES app_user(id),
  due_at             timestamptz,
  done_at            timestamptz,
  done_by            uuid REFERENCES app_user(id),
  notes              text,
  CHECK (type <> 'review_duplicate' OR (person_id IS NOT NULL AND related_person_id IS NOT NULL
                                       AND person_id <> related_person_id)),
  CHECK ((done_at IS NULL) = (done_by IS NULL))
);
CREATE INDEX task_open_by_assignee_idx ON task (assigned_user_id, due_at) WHERE done_at IS NULL;
CREATE INDEX task_person_idx ON task (person_id);

CREATE TABLE consent (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES app_user(id),
  person_id    uuid NOT NULL REFERENCES person(id),
  purpose      text NOT NULL CHECK (purpose IN ('marketing_email','marketing_whatsapp','data_processing')),
  is_granted   boolean NOT NULL,
  source       text,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
-- "Latest row per (person, purpose) wins" — this index makes that lookup cheap.
CREATE INDEX consent_latest_idx ON consent (person_id, purpose, recorded_at DESC);
CREATE TRIGGER consent_append_only BEFORE UPDATE OR DELETE ON consent
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE VIEW consent_current AS
  SELECT DISTINCT ON (person_id, purpose) person_id, purpose, is_granted, source, recorded_at
  FROM consent
  ORDER BY person_id, purpose, recorded_at DESC;

CREATE TABLE message_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES app_user(id),
  person_id            uuid REFERENCES person(id),
  enquiry_id           uuid REFERENCES enquiry(id),
  channel              text NOT NULL CHECK (channel IN ('whatsapp','email')),
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  external_message_id  text,
  template_name        text,
  status               text,
  sent_at              timestamptz,
  body                 text                                       -- nullable; open item O2
);
CREATE UNIQUE INDEX message_log_external_uq ON message_log (channel, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX message_log_person_idx ON message_log (person_id, sent_at);

-- =============================================================================
-- Integration plumbing
-- =============================================================================

CREATE TABLE event_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id),
  type            text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  processed_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX event_outbox_pending_idx ON event_outbox (created_at) WHERE processed_at IS NULL;

CREATE TABLE integration_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES app_user(id),
  source             text NOT NULL,
  external_event_id  text NOT NULL,
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  status             text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored')),
  error              text,
  UNIQUE (source, external_event_id)                              -- webhook idempotency
);

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  user_id     uuid REFERENCES app_user(id),
  action      text NOT NULL,
  entity      text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- =============================================================================
-- updated_at triggers on every mutable table
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user','app_setting','person','company','company_membership','tag',
    'course','class','class_notice','lost_reason','deal','enrolment','payment',
    'enquiry','task','message_log','event_outbox','integration_event'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- =============================================================================
-- Seed data
-- =============================================================================
INSERT INTO lost_reason (code, label_en, sort_order) VALUES
  ('price',              'Price',                     10),
  ('timing',             'Timing / date',             20),
  ('language',           'Language',                  30),
  ('competitor',         'Chose a competitor',        40),
  ('no_hrdc_budget',     'No HRDC budget',            50),
  ('not_decision_maker', 'Not the decision-maker',    60),
  ('no_response',        'No response',               70),
  ('not_a_fit',          'Not a fit',                 80);

-- Values from the Section 15.3 decision calendar fallbacks. HRDC values are
-- deliberately null until Finance supplies them (O7).
INSERT INTO app_setting (key, value) VALUES
  ('reservation_expiry_hours',   '48'),
  ('first_response_sla_minutes', '60'),
  ('idle_timeout_hours',         '8'),
  ('hrdc_grant_lead_days',       'null'),
  ('hrdc_claim_window_days',     'null');

COMMIT;
