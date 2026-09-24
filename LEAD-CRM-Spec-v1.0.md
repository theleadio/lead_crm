# LEAD CRM — Software Specification v1.4

_Last updated 24 Sep 2026 · Owner: Shawn_

## Changelog

| Version | Date | Changes |
| --- | --- | --- |
| v1.4 | 24 Sep 2026 | What the lead form's `companyName` does — it was sent but never saved. Migration 003: `person.company_name_given`, `company.name_norm`, `link_company_from_form()` (§5, §8.2, §8.3); company picker on person detail (§9.2); soft-match "company matches" defined (§12.2). |
| v1.3 | 24 Sep 2026 | Migration 002: `needs_review_reason` and `erased_at` on person (§5); merge, erasure and soft delete as tested database functions (§12.10); merge route body and two new routes (§7, §7.1); concurrency switched to If-Match with a microsecond version (§7); open items O11–O15 (§15.3). |
| v1.2 | 24 Sep 2026 | From Zixuan's review of §9–11: new routes (§7.1), public register route (§8.3), `hrdcIntended` on leads, soft-match rule rewritten (§12.2), part-time "assigned" + create rule (§6), propose/request as tasks (§6), Home page (§9.0), schema changes (§5), Supabase env vars (§2). Schema v1 DDL issued. |
| v1.1 | 22–23 Sep 2026 | `class_notice`, `tag`, `person_tag`, `lost_reason` tables; `payment.notes`; `deal.lost_reason_id`; last activity (§12.9); audit log viewer (§9.16); auth decision; decision calendar (§15.3) |
| v1.0 | 22 Sep 2026 | First issue |

Build reference for Zixuan (CRM app, website, landing pages) and Shawn (data, integrations). Companion to the LEAD Unified CRM Solution Blueprint.

## 1. Purpose & Scope

This document is the build reference for the LEAD CRM. Where it disagrees with the Solution Blueprint, this document wins for implementation detail; the Blueprint wins for business intent.

**Target:** first production release on **14 Dec 2026**. Anything not marked **MVP** below is out of scope until January.

**How to read this spec:** Sections 4, 5 and 12 are rules that must hold everywhere. Sections 6–10 are things to build, roughly in order. Section 15 is the checklist for calling something finished.

### Ownership

| Area                                             | Owner                                                                     | Meaning                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------- |
| CRM web app (all screens, routing, forms, state) | Zixuan                                                                    | Builds Sections 6, 9                           |
| Public website + landing pages                   | Zixuan                                                                    | Builds Section 10                              |
| Database schema and migrations                   | Shawn                                                                     | Section 5 is the contract Zixuan codes against |
| Internal API implementation                      | Shared — Zixuan writes CRUD endpoints, Shawn writes integration endpoints | Section 7 says which                           |
| Webhooks, n8n flows, sync jobs                   | Shawn                                                                     | Section 11                                     |
| Dashboards (BI tool)                             | Shawn                                                                     | Not in the app; reads the database directly    |

### Rules of engagement

1. **Schema frozen from 16 Oct.** After that date, any change to Section 5 is a request to Shawn, not a local migration. Zixuan never edits migration files.
2. **No direct database access from the frontend.** Every read/write goes through the API in Section 7.
3. **Never invent a field.** If a screen needs data Section 5 has no column for, raise it — don't stuff it into an existing field or a JSON blob.
4. **Write-then-verify for money.** No screen may create/edit/delete a `payment` row directly; payments arrive from Stripe or the manual-payment endpoint, which validates.
5. **Anything ambiguous goes in Section 15** as an open item rather than being guessed in code.

## 2. Tech Stack & Setup

One Next.js repo, one Postgres database, TypeScript everywhere.

| Layer          | Choice                                                              | Notes                                                  |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Framework      | Next.js (App Router) + TypeScript, strict mode                      | Pages and API routes in one deployable                 |
| UI             | Tailwind CSS + headless component library (shadcn/ui or equivalent) | No custom design system                                |
| Database       | PostgreSQL, managed (Supabase or equivalent, Singapore region)      | Section 5                                              |
| DB access      | Prisma or Drizzle — Shawn picks and owns the schema file            | Zixuan uses generated client, never raw SQL in screens |
| Auth           | Platform auth (email+password or Google SSO) with MFA available     | Section 6                                              |
| Jobs           | Postgres-backed queue (pg-boss)                                     | Shawn's side                                           |
| File storage   | S3-compatible bucket (receipts, HRDC documents)                     | Private bucket, signed URLs only                       |
| Email          | Transactional ESP (Resend/Postmark class)                           | Shawn's side                                           |
| Hosting        | Vercel or equivalent; database in Singapore                         |                                                        |
| Error tracking | Sentry (or equivalent), client and server                           | Required before go-live                                |

### Repo layout

```
/app
  /(crm)        - authenticated CRM screens
    /people /companies /deals /classes /enrolments /enquiries /settings
  /(public)     - public pages the website calls
  /api          - route handlers (see Section 7)
/components     - shared UI
/lib
  /db           - schema + generated client (Shawn owns)
  /auth         - session + permission helpers
  /validation   - zod schemas, shared by API and forms
  /format       - phone, money, date helpers (Section 4)
/tests
```

### Environments

| Env        | Database                      | Stripe    | WATI                | Who deploys                |
| ---------- | ----------------------------- | --------- | ------------------- | -------------------------- |
| local      | local or branch DB            | test keys | sandbox or disabled | either                     |
| staging    | separate DB, seeded fake data | test mode | test number         | auto on merge to `main`    |
| production | production DB                 | live keys | live number         | manual promote, Shawn only |

No production customer data in staging, ever — seed it instead (PDPA, Blueprint Section 20).

### Environment variables (fixed names)

```
DATABASE_URL
AUTH_SECRET
APP_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   - older projects call it the anon key
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
WATI_API_BASE / WATI_TOKEN
PUBLIC_API_KEY        - website -> CRM form intake
S3_BUCKET / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY
ESP_API_KEY
SENTRY_DSN
```

Secrets live in the hosting platform's secret store and a shared password manager. Never in the repo, never in a committed `.env`, never in WhatsApp.

### Conventions

- Branches: `feat/<short-name>`, `fix/<short-name>`. PR into `main`, one reviewer — Zixuan and Shawn review each other.
- Commits: short imperative subject ("add class seat counter").
- Formatting: Prettier + ESLint on commit. No debates.
- Every PR that changes a screen includes a screenshot in the description.

## 3. Architecture & Boundaries

The app is the only thing that writes to business tables. Integrations write into a staging table first and a worker promotes them, so a bad webhook can never corrupt a Person record directly.

```
Zixuan: Website+landing pages (WEB), CRM screens (UI), CRUD API routes (API)
Shawn: Public intake API (PUB), Webhook endpoints (HOOK), Workers + n8n (WORK), Reporting views (VIEWS)

WEB --> PUB (form submit, and reads schedule)
UI --> API --> DB
PUB --> DB
HOOK --> DB
WORK --> DB
DB --> VIEWS
```

### The four contracts

| #   | Contract                            | Section | Frozen by |
| --- | ----------------------------------- | ------- | --------- |
| C1  | Database schema                     | 5       | 16 Oct    |
| C2  | Internal API shapes                 | 7       | 16 Oct    |
| C3  | Public form intake + schedule feed  | 8       | 16 Oct    |
| C4  | Domain events written to the outbox | 11      | 30 Oct    |

**Layering rule.** Screen → API route → service function in `/lib` → database. No DB calls in React components, no business logic in components either — seat maths, dedupe, status transitions all live in `/lib` so API and workers apply the same rules.

**The outbox.** Every write that others might react to also inserts a row into `event_outbox` in the same transaction. Zixuan's code writes these rows; Shawn's workers read them. A screen's write that forgets its outbox row means the automation silently never runs — events in Section 11 are acceptance criteria, not an afterthought.

**Deliberately not in the app:** dashboards/charts (BI tool reads DB), sending email/WhatsApp (screens raise events, workers send), ad platform data (n8n writes it, nothing in app reads it before January).

## 4. Shared Conventions

| Topic         | Rule                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Primary keys  | UUID v4, column `id`. Never expose sequential integers                                                    |
| Timestamps    | `timestamptz`, always UTC. Every table has `created_at`, `updated_at`                                     |
| Display time  | Rendered in Asia/Kuala_Lumpur. Dates `DD MMM YYYY` (22 Sep 2026), times `h:mma` (9:00am)                  |
| Money         | `numeric(12,2)`, MYR only. Columns end in `_myr`. Never float                                             |
| Money display | `RM3,200.00`. Never round before totals computed                                                          |
| Soft delete   | `deleted_at timestamptz null`. Every query filters `deleted_at IS NULL` unless explicitly showing deleted |
| Created by    | `created_by uuid` → `app_user`, null when system created                                                  |
| Enums         | Postgres text + CHECK constraint, not native enum types. `lower_snake_case` values                        |
| Booleans      | Name positively: `is_active`, not `is_not_active`                                                         |

**Email normalisation.** Store both: `email` as typed, `email_norm` lowercased/trimmed. Uniqueness/matching use `email_norm`. Reject anything without a single `@` and a dot in the domain — no cleverer validation.

**Phone normalisation.** Store both: `phone` as typed, `phone_e164` normalised.

| Typed           | phone_e164   |
| --------------- | ------------ |
| 012-345 6789    | +60123456789 |
| 0123456789      | +60123456789 |
| 60123456789     | +60123456789 |
| +60 12-345 6789 | +60123456789 |

Rule: strip non-digit/non-leading-`+`; starts `0` → replace with `+60`; starts `60` and 11–12 digits → prefix `+`; already starts `+` → keep. Unnormalisable numbers: store in `phone`, `phone_e164` null, flag for review — never silently drop. Use `libphonenumber-js`, default region MY.

**Names.** One `full_name` field — no first/last split (Malaysian/Chinese naming doesn't divide cleanly). `preferred_name` optional, used in messages when present.

**Language.** `en` or `zh` in DB, never "English"/"Chinese". Screens display the full word.

**Idempotency.** Any endpoint callable twice by an external system takes an idempotency key, no-ops on repeat. Covers form intake and all webhook processing.

**Audit.** Every create/update/delete/export/permission change writes an `audit_log` row (acting user, entity, before/after JSON). Blueprint + PDPA requirement — not optional, not deferrable.

## 5. Data Model

23 tables for MVP (4 added 22 Sep, `app_setting` added 24 Sep). DDL: schema v1 (`001_schema_v1.sql`, issued 24 Sep) `002_merge_erase.sql` and `003_company_from_form.sql` (24 Sep), all in `lib/db/migrations/`. Shawn owns migrations; this is the contract Zixuan codes against. Every table has standard columns from Section 4 (`id`, `created_at`, `updated_at`, `created_by`) — not repeated below.

### Entity relationships

```
COMPANY ||--o{ COMPANY_MEMBERSHIP : employs
PERSON ||--o{ COMPANY_MEMBERSHIP : belongs
PERSON ||--o{ TOUCHPOINT : generates
PERSON ||--o{ DEAL : contact
COMPANY ||--o{ DEAL : buyer
PERSON ||--o{ ENROLMENT : attends
CLASS ||--o{ ENROLMENT : holds
COURSE ||--o{ CLASS : scheduled
DEAL ||--o{ ENROLMENT : produces
ENROLMENT ||--o{ PAYMENT : settles
PERSON ||--o{ ENQUIRY : raises
PERSON ||--o{ TASK : about
PERSON ||--o{ CONSENT : gives
APP_USER ||--o{ DEAL : owns
```

### Enumerations (text + CHECK constraint)

| Enum                    | Values                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `language`              | en, zh                                                                                                                      |
| `lifecycle_stage`       | lead, student, customer (computed, Section 12)                                                                              |
| `deal_pipeline`         | individual, corporate                                                                                                       |
| `deal_stage_individual` | new, engaged, qualified, checkout_sent, won, lost                                                                           |
| `deal_stage_corporate`  | new, discovery, proposal_sent, funding, won, lost                                                                           |
| `funding_type`          | self, company, hrdc, other                                                                                                  |
| `lost_reason`           | **now an editable table, not an enum** (see below)                                                                          |
| `class_status`          | draft, open, few_seats, full, cancelled, completed                                                                          |
| `class_mode`            | in_person, online, hybrid                                                                                                   |
| `course_track`          | certification, mastery, masterclass, workshop, conference, corporate                                                        |
| `enrolment_status`      | reserved, payment_pending, waitlisted, confirmed, onboarded, attended, completed, no_show, transferred, cancelled, refunded |
| `payment_method`        | stripe_card, stripe_fpx, bank_transfer, hrdc, invoice                                                                       |
| `payment_status`        | pending, succeeded, failed, refunded, partially_refunded                                                                    |
| `enquiry_status`        | open, ai_resolved, human_resolved, converted, closed                                                                        |
| `enquiry_category`      | course_info, schedule, price, hrdc, corporate, registration_help, payment_issue, post_class, complaint, other               |
| `consent_purpose`       | marketing_email, marketing_whatsapp, data_processing                                                                        |
| `task_type`             | call, follow_up, review_duplicate, match_payment, hrdc_deadline, export_request, other                                                      |

**Changed 22 Sep:** `lost_reason` is now an editable table (Settings must let Sales add reasons without a migration). `deal.lost_reason_id` FKs to it.

### Table definitions

**`person`** — one row per human, ever.

| Column              | Type              | Rules                                                          |
| ------------------- | ----------------- | -------------------------------------------------------------- |
| full_name           | text              | required                                                       |
| preferred_name      | text              | optional                                                       |
| email / email_norm  | text              | email_norm unique where not null and not deleted               |
| phone / phone_e164  | text              | phone_e164 unique where not null and not deleted               |
| whatsapp_e164       | text              | defaults to phone_e164                                         |
| preferred_language  | language          | default en                                                     |
| job_title           | text              | optional                                                       |
| owner_user_id       | uuid → app_user   | nullable                                                       |
| first_touchpoint_id | uuid → touchpoint | set once, never updated                                        |
| wati_contact_id     | text              | nullable                                                       |
| stripe_customer_id  | text              | nullable                                                       |
| needs_review        | bool              | true when phone couldn't be normalised or soft duplicate found |
| needs_review_reason | text              | why it was flagged: phone_unnormalised, possible_duplicate_company, possible_duplicate_email, possible_duplicate_phone, no_name. Set and cleared together with needs_review (CHECK) |
| erased_at           | timestamptz       | set by erase_person() (§12.10); erased rows also get deleted_at |
| company_name_given  | text              | what the person typed as company on the latest public form (max 200). Informational — company_membership is the truth. Set only by link_company_from_form() (§8.2) |
| merged_into_id      | uuid → person     | set when merged away; such rows hidden from all lists          |
| notes               | text              | free text                                                      |
| deleted_at          | timestamptz       |                                                                |
| last_activity_at    | timestamptz       | maintained by service layer, Section 12.9                      |

Indexes: email_norm, phone_e164, owner_user_id, full_name (trigram search). No `tags` column — tags live in their own tables.

**`company`** — legal_name (required), registration_no, industry, size_band, hrdc_registered bool, billing_address, billing_email, owner_user_id, deleted_at. `name_norm` (v1.4) is generated from legal_name by `normalise_company_name()` — never written by the app.

**`company_membership`** — person_id, company_id, job_title, is_hr_contact bool, is_billing_contact bool, start_date, end_date. Unique on (person_id, company_id) where end_date is null.

**`touchpoint`** — append-only, never updated/deleted. person_id, occurred_at, channel (web_form, whatsapp, ctwa, lead_form, walk_in, referral, payment_link, import), utm_source/medium/campaign/content/term, gclid, fbclid, ctwa_clid, landing_url, referrer, form_name, is_first_touch bool. Index on (person_id, occurred_at).

**`course`** — code (unique, e.g. AIA), name_en, name_zh, track, duration_days, list_price_myr, hrdc_claimable bool, description_en/zh, is_active bool.

**`class`** — one scheduled run; the table the website reads.

| Column                            | Type          | Rules                                                   |
| --------------------------------- | ------------- | ------------------------------------------------------- |
| course_id                         | uuid → course | required                                                |
| code                              | text          | unique, e.g. AIA-2610-EN                                |
| start_date / end_date             | date          | end_date >= start_date                                  |
| start_time / end_time             | time          | display only                                            |
| language                          | language      | required                                                |
| mode                              | class_mode    | required                                                |
| venue_name / venue_address / city | text          | required unless mode is online                          |
| online_url                        | text          | required unless mode is in_person; never shown publicly |
| capacity                          | int           | > 0                                                     |
| few_seats_threshold               | int           | default 5                                               |
| price_myr                         | numeric       | overrides course list price when set                    |
| status                            | class_status  | see Section 12                                          |
| is_public                         | bool          | controls website feed appearance                        |
| trainer_user_ids                  | uuid[]        |                                                         |
| hrdc_claimable                    | bool          | defaults from course                                    |

Indexes: (start_date, is_public, status), course_id.

**`enrolment`** — a person in a class. person_id, class_id, deal_id (nullable), booker_person_id (nullable — HR officer who registered them), status, payer_type (self, company), seat_reserved_until, onboarding_step int, price_paid_myr, certificate_no, completed_at, cancelled_reason, transferred_to_enrolment_id. **Unique on (person_id, class_id) where status not in (cancelled, refunded)** — stops double-booking.

**`deal`** — pipeline, stage, person_id, company_id, course_id, class_id, headcount int (corporate), amount_myr, funding_type, hrdc_grant_ref, hrdc_approval_date, hrdc_deadline_date, `lost_reason_id uuid → lost_reason.id` (nullable), owner_user_id, won_at, lost_at, stage_changed_at.

**Fixed 23 Sep (Shawn):** FK points at `lost_reason.id`, not `code` — `code` is the stable value reports group by, but joining on the surrogate key lets a code be corrected later without rewriting historical deals. API responses nest it: `{ lostReason: { id, code, labelEn } }` — UI renders `labelEn`, reporting groups by `code`.

**`deal_stage_history`** — deal_id, from_stage, to_stage, changed_by, changed_at. Written on every stage change; enables conversion reporting.

**`payment`** — enrolment_id or deal_id (at least one, unless `match_status = unmatched` — see v1.2 changes below), match_status (matched, unmatched), method, status, amount_myr, currency default MYR, stripe_payment_intent_id (unique where not null), stripe_checkout_session_id, reference_no, proof_file_key (S3 key), paid_at, refunded_amount_myr, notes text (added 22 Sep, free text from manual payment modal), recorded_by.

**`enquiry`** — person_id, channel, category, status, handled_by (ai, user), assigned_user_id, wati_conversation_id, first_message_at, first_response_at, closed_at, deal_id, summary text.

**`task`** — type, title, person_id, deal_id, enrolment_id, assigned_user_id, due_at, done_at, done_by, notes.

**`consent`** — person_id, purpose, is_granted bool, source text, recorded_at. Latest row per (person, purpose) wins.

**`app_user`** — email (unique), full_name, role_code, is_active, employment_type (full_time, part_time), last_login_at.

**`message_log`** — person_id, enquiry_id, channel (whatsapp, email), direction (in, out), external_message_id (unique where not null), template_name, status, sent_at, body (nullable — PDPA decision open, Section 15).

**`event_outbox`** — type, aggregate_type, aggregate_id, payload jsonb, created_at, processed_at, attempts, last_error. Index on processed_at where null.

**`integration_event`** — source, external_event_id (unique per source), payload jsonb, received_at, processed_at, status, error.

**`audit_log`** — user_id, action, entity, entity_id, before jsonb, after jsonb, ip, at.

**`class_notice`** — added 22 Sep; supports 9.9, 9.10, and `noticeId` in Section 11.

| Column                    | Type               | Rules                                                             |
| ------------------------- | ------------------ | ----------------------------------------------------------------- |
| class_id                  | uuid → class       | required                                                          |
| status                    | text               | pending, approved, sent, discarded                                |
| changed_fields            | jsonb              | e.g. `{"start_date": {"from": "2026-10-06", "to": "2026-10-13"}}` |
| message_en / message_zh   | text               | drafted from template, editable before approval                   |
| recipient_count           | int                | snapshot at creation                                              |
| created_by                | uuid → app_user    | who made the class change                                         |
| approved_by / approved_at | uuid / timestamptz | null until approved                                               |
| sent_at                   | timestamptz        | set by worker after sending                                       |
| send_error                | text               | nullable                                                          |

Only one `pending` notice per class at a time — a second edit while one is pending updates the existing notice's `changed_fields` instead of creating a second one.

**`tag`** — added 22 Sep. name (unique, case-insensitive), colour text nullable, is_system bool. System tags come from data import (`[source]` meta, `[workshop]` 25 Sep) and cannot be renamed by users; user tags can.

**`person_tag`** — person_id, tag_id, tagged_at, tagged_by. PK on (person_id, tag_id). Index on tag_id.

**`lost_reason`** — added 22 Sep, replaces the enum. code (unique, stable — reports group by this), label_en, label_zh, sort_order int, is_active bool. Seed with the eight reasons from the Blueprint. Deactivating hides from new deals but keeps on old ones — never delete a row.

**Schema changes 24 Sep (v1.2)** — all before the 16 Oct freeze.

| Table | Change | Why |
| --- | --- | --- |
| app_user | add `auth_user_id text unique` | Links to the auth provider's user id; matching on email breaks when an email changes |
| deal | add `checkout_url`, `checkout_session_id`, `checkout_sent_at` | §13 says the link lives on the deal record |
| payment | add `match_status` (matched, unmatched), default matched. Constraint: enrolment_id or deal_id set, **or** unmatched | An unmatched Stripe payment is still real money and must be stored (§11.3) |
| task | add `related_person_id uuid → person` | A merge proposal names two people |
| task_type | add `export_request` | Management's "request" export (§6) |
| new `app_setting` | `key text PK`, `value jsonb`, `updated_by`, `updated_at` | HRDC lead time, claim window, reservation expiry, SLA — the configurable values in §12.1, §12.6, §15.3 |

**Schema changes 24 Sep, migration 002 (v1.3)**

| Table | Change | Why |
| --- | --- | --- |
| person | add `needs_review_reason`, `erased_at` | The 9.4 review queue shows why a record was flagged; erasure needs a marker |
| touchpoint, consent | append-only trigger now lets `merge_person()` change `person_id` (and `is_first_touch`) and nothing else | A merge has to move history onto the kept person — Zixuan's catch |
| functions | `merge_person`, `erase_person`, `soft_delete_person`; EXECUTE revoked from PUBLIC and Supabase's `anon`/`authenticated` | One tested implementation of each rule; cannot be called with the publishable key |

**Schema changes 24 Sep, migration 003 (v1.4)**

| Table | Change | Why |
| --- | --- | --- |
| person | add `company_name_given text` | The lead form sends `companyName` but nothing stored it |
| company | add `name_norm` (generated) + index | One "same company name" rule for form linking, the soft match and "similar companies" on Add company |
| functions | `normalise_company_name(text)`, `link_company_from_form(person, text)`; `erase_person` also clears `company_name_given` | Same reasons as 002 |

**Onboarding templates have no table, deliberately.** WhatsApp templates must be Meta-approved and live in WATI; email templates live in the ESP. Settings links out to both.

**Deferred to January:** `campaign`, `ad`, `ad_metric_daily`, `content_item`, `attendance`, `class_session`. Do not build screens for these.

## 6. Auth & Permissions

Permissions enforced server-side, in one place. UI hides what a user can't do, but that's not security — every API route checks independently.

**Sign-in.** Email + password with MFA, built behind an auth abstraction in `/lib/auth` so Google SSO can be added later as a provider swap (**decided 23 Sep** — see decision calendar in §15.3). No shared accounts. Sessions expire after 8 hours inactivity. A deactivated `app_user` loses access on next request, not next login.

**Roles** (`role_code` on app_user, one per user): `super_admin`, `management`, `marketing`, `sales`, `support`, `operations`, `part_time`

### Permission matrix

F = full, E = create/edit, R = read, A = assigned records only, — = no access.

| Resource          | super_admin | management | marketing      | sales   | support | operations  | part_time |
| ----------------- | ----------- | ---------- | -------------- | ------- | ------- | ----------- | --------- |
| person/company    | F           | R          | R¹             | E       | E       | R           | A         |
| deal              | F           | R          | R              | E       | E       | R           | —         |
| enquiry           | F           | R          | —              | R       | E       | R           | A         |
| course/class      | F           | R          | R              | R       | R       | F           | R         |
| enrolment         | F           | R          | —              | R       | R       | F           | —         |
| payment           | F           | R          | —              | R²      | —       | E³          | —         |
| task              | F           | R          | E              | E       | E       | E           | A         |
| consent           | F           | R          | R              | R       | E       | R           | —         |
| export CSV        | F           | request    | aggregate only | —       | —       | class lists | —         |
| merge person      | F           | —          | —              | propose | propose | propose     | —         |
| app_user/settings | F           | —          | —              | —       | —       | —           | —         |
| audit_log         | R           | R          | —              | —       | —       | —           | —         |

¹ Marketing sees person records with phone/email masked (`012-•••• 6789`, `s••••@gmail.com`), no export.
² Sales sees payments only on deals they own.
³ Operations can record a manual payment but cannot refund — refunds are super_admin only, in Stripe, then reconciled.

**Implementation.** One helper used by every route: `requirePermission(session, 'enrolment', 'write', { recordOwnerId })` → throws 403, client renders standard "no access" screen. `part_time` "assigned only" is enforced at the query level (`WHERE assigned_user_id = :me`), not by filtering after fetch — no path to page through all 13,000 contacts.

Masking happens server-side — Marketing's API responses contain masked strings only, real values never reach that browser.

**What "assigned" means per resource (added 24 Sep).** A part-timer can see: enquiries and tasks where `assigned_user_id` is them; people they own (`owner_user_id`) or who have an enquiry or task assigned to them; companies of those people.

**Part-timers may create people, but only as part of an enquiry.** Their Add person creates the person plus an open enquiry assigned to them in one transaction, so they keep sight of the record. `owner_user_id` stays empty so sales assignment works normally. No standalone Add person button on the People list for part-timers.

**"Propose" and "request" are tasks (added 24 Sep).** No new routes:

- **Merge proposal** (sales, support, operations): `POST /api/tasks` with `type = 'review_duplicate'`, `person_id` + `related_person_id`, assigned to a super_admin, who resolves it with the 9.3 merge screen.
- **Export request** (management): Export button creates `type = 'export_request'` assigned to a super_admin, filters stored in `notes`. Nothing downloads for management directly.

**Audit.** Sign-in, sign-out, failed sign-in, permission denial, every export, every payment record view — all audit-logged.

## 7. Internal API

REST under `/api`, JSON, session cookie auth. Shared zod schema validation (form + endpoint reject the same things).

**Response envelope.** Success: resource, or `{ data, page }` for lists. Errors:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Phone number is not valid",
    "fields": { "phone": "Enter a Malaysian mobile number" }
  }
}
```

**Status codes:** 200 ok · 201 created · 400 validation · 401 not signed in · 403 no permission · 404 not found · 409 conflict (duplicate, seat gone, stale edit) · 422 business rule broken · 500 unexpected.

**List conventions.** Every list endpoint: `?q=&page=&limit=&sort=&filter[...]`. Default limit 25, max 100. Always `{ data: [], page: { total, page, limit } }`. No eager-loading whole relations into table views.

### Endpoints

| Method + path                                 | Purpose                          | Owner  | Notes                                                                                    |
| --------------------------------------------- | -------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| GET /api/people                               | Search + list                    | Zixuan | q matches name/email/phone, normalised before matching                                   |
| POST /api/people                              | Create                           | Zixuan | Runs dedupe (§12); 409 with existing record on hard match                                |
| GET /api/people/:id                           | Detail + timeline                | Zixuan | person + deals + enrolments + enquiries + touchpoints                                    |
| PATCH /api/people/:id                         | Update                           | Zixuan | Partial; audit-logged                                                                    |
| POST /api/people/:id/merge                    | Merge into another               | Zixuan | super_admin only; body `{targetId, fields?}`. One transaction: `merge_person(:id, targetId, sessionUserId)`, then apply `fields` (9.3 per-field choices) to the target and audit-log them. `merge_blocked` → 409 with the message and class codes (§12.10) |
| GET/POST/PATCH /api/companies[/:id]           | Company CRUD                     | Zixuan |                                                                                          |
| POST /api/companies/:id/members               | Attach person                    | Zixuan | body `{personId, jobTitle, isHrContact, isBillingContact}`                               |
| GET /api/deals                                | Pipeline board + list            | Zixuan | filter[pipeline], filter[stage], filter[owner]                                           |
| POST /api/deals                               | Create                           | Zixuan |                                                                                          |
| PATCH /api/deals/:id                          | Update fields                    | Zixuan |                                                                                          |
| POST /api/deals/:id/stage                     | Move stage                       | Zixuan | body `{toStage, lostReasonId?}`; writes history + outbox event; 422 if lost without an active reason |
| POST /api/deals/:id/checkout-link             | Generate Stripe link             | Shawn  | Returns `{url}` and stores it on the deal (§7.1); Zixuan calls from deal screen                                           |
| GET/POST/PATCH /api/courses[/:id]             | Course catalogue                 | Zixuan |                                                                                          |
| GET /api/classes                              | List with seat counts            | Zixuan | Returns capacity, confirmedCount, reservedCount, seatsAvailable                          |
| POST/PATCH /api/classes[/:id]                 | Create/edit                      | Zixuan | Takes optional `notice: 'prepare' \| 'skip'`; see §7.1 (409 `notice_decision_required`)   |
| POST /api/classes/:id/cancel                  | Cancel class                     | Zixuan | Requires reason; sets all enrolments cancelled; raises event                             |
| GET /api/classes/:id/roster                   | Enrolment list                   | Zixuan | Used by class detail + CSV export                                                        |
| GET /api/enrolments[/:id]                     | List + detail                    | Zixuan |                                                                                          |
| POST /api/enrolments                          | Create manually                  | Zixuan | Seat check inside transaction; 409 no_seats                                              |
| POST /api/enrolments/:id/status               | Change status                    | Zixuan | Validated against state machine; 422 on illegal jump                                     |
| POST /api/enrolments/:id/transfer             | Move to another class            | Zixuan | body `{toClassId}`; seat check on target                                                 |
| POST /api/payments/manual                     | Record bank/HRDC/invoice payment | Zixuan | Requires method, amount, reference, proof upload; confirms enrolment                     |
| POST /api/uploads/sign                        | Signed upload URL                | Zixuan | Payment proof, HRDC documents                                                            |
| GET/PATCH /api/enquiries[/:id]                | Support queue                    | Zixuan |                                                                                          |
| POST /api/enquiries/:id/convert               | Create deal from enquiry         | Zixuan | Links both, assigns owner, raises event                                                  |
| GET/POST/PATCH /api/tasks[/:id]               | Tasks                            | Zixuan | filter[mine]=true for default view                                                       |
| GET /api/consent/:personId, POST /api/consent | Consent records                  | Zixuan |                                                                                          |
| GET/POST/PATCH /api/users[/:id]               | User admin                       | Zixuan | super_admin only                                                                         |
| GET /api/health/integrations                  | Integration status panel         | Shawn  | Zixuan renders it                                                                        |
| POST /api/webhooks/stripe, /wati              | Inbound webhooks                 | Shawn  | No session; signature-verified                                                           |

### 7.1 Routes added 24 Sep (v1.2)

From Zixuan's review of §9–11 against the table above.

| Method + path | Purpose | Owner | Notes |
| --- | --- | --- | --- |
| POST /api/people/bulk | Bulk assign owner / add tag | Zixuan | body `{personIds[], action: 'assign_owner'\|'add_tag', ownerId?, tagId?}`; max 500; one audit row per person |
| GET /api/people/export | People CSV | Zixuan | super_admin only; streams; audit-logged with filter + row count |
| GET /api/people/:id/timeline | Paginated timeline for 9.2 | Zixuan | touchpoints, stage changes, tasks, messages, payments, enrolment changes; newest first, 50/page. Keeps GET /api/people/:id fast |
| GET /api/people/:id/data-export | PDPA portability export | Zixuan | `?format=json\|csv`; super_admin (on the person's request); audit-logged |
| GET /api/users/options | `{id, fullName}` of active users for owner filters/pickers | Zixuan | Every signed-in role; nothing else returned |
| GET /api/tags | Tag list for filters + bulk tag | Zixuan | Every role that can read people |
| PATCH /api/tags/:id | Rename / deactivate | Zixuan | super_admin; 422 on system tags |
| POST /api/tags/:id/merge | Merge into another tag | Zixuan | body `{intoTagId}`; moves person_tag rows, deactivates source |
| GET /api/lost-reasons | Active reasons, in order | Zixuan | Every role that can read deals (Lost dialog) |
| POST/PATCH /api/lost-reasons[/:id] | Create / rename / deactivate | Zixuan | super_admin |
| POST /api/lost-reasons/reorder | Reorder | Zixuan | body `{ids[]}` in new order |
| DELETE /api/people/:id | Soft delete a junk/test record (v1.3) | Zixuan | super_admin; body `{reason}` required; calls `soft_delete_person()`; 409 "use erase instead" if the person has any enrolment or payment |
| POST /api/people/:id/erase | PDPA erasure — anonymise (v1.3) | Zixuan | super_admin, on the person's request; body `{reason}` required; calls `erase_person()`; irreversible, confirm by typing the name; §12.10 |
| GET /api/companies/:id | Company detail | Zixuan | company + members + deals + enrolment summary |
| GET /api/deals/:id | Deal detail | Zixuan | deal + stageHistory[] + tasks + linked enquiry |
| GET /api/audit-log | Audit viewer (9.16) | Zixuan | super_admin, management; filters per 9.16; 50/page |
| GET /api/classes/:id/roster.csv | Roster export | Zixuan | operations, super_admin; audit-logged |
| GET /api/classes/:id/notices | Notices for a class | Zixuan | Pending first |
| PATCH /api/class-notices/:id | Edit message EN/ZH | Zixuan | Only while pending |
| POST /api/class-notices/:id/approve | Approve and send | Zixuan | operations, super_admin; raises ClassNoticeApproved; Shawn's worker sends |
| POST /api/class-notices/:id/discard | Discard | Zixuan | Only while pending |
| POST /api/payments/:id/match | Resolve unmatched Stripe payment (§11.3) | Zixuan | body `{personId, classId}`; one transaction: creates enrolment, links payment, sets match_status = matched, closes the match_payment task |

**Changes to existing routes**

- GET /api/deals also returns `stageTotals: [{stage, count, totalMyr}]` over the whole filtered set (not the current page). Board headers use it.
- PATCH /api/classes/:id takes optional `notice: 'prepare' | 'skip'`. If the edit touches a notice field on a class with confirmed enrolments and `notice` is absent → **409 `notice_decision_required`** with `{recipientCount}`, nothing saved. UI shows the 9.9 dialog and resubmits with the choice. The server decides whether a notice is needed, never the client.
- POST /api/deals/:id/checkout-link stores `checkout_url`, `checkout_session_id`, `checkout_sent_at` on the deal as well as returning it.

**Concurrency** (revised 24 Sep, v1.3). GET on person/deal/class/enrolment returns `version` = `updated_at::text` — the Postgres text form with full microseconds. Don't round-trip it through a JS `Date`, which keeps milliseconds only and would never match. PATCH sends `If-Match: <version>`; the server runs `UPDATE … WHERE id = $1 AND updated_at = $2::timestamptz`. 0 rows → 409, client shows "someone else changed this record — reload". Missing header → 428. This replaces `If-Unmodified-Since`, which works in whole seconds and would miss two edits in the same second.

**Transactions.** Anything touching seats or money: check + write in one DB transaction with row locked — never check-then-write across two calls. Two people paying for the last seat simultaneously → one confirmed enrolment, one clean 409.

## 8. Public API

Three endpoints the public website uses — the only routes reachable without a session. Rate-limited, key-protected, deliberately narrow.

### 8.1 GET /api/public/schedule

Returns upcoming public classes, replacing the hard-coded website schedule.

Query: `?language=en|zh&track=<course_track>&city=<city>&limit=<n>` — all optional.

```json
{
  "generatedAt": "2026-12-14T02:00:00Z",
  "classes": [
    {
      "id": "b1f2...",
      "code": "AIA-2610-EN",
      "courseName": "AI Agentic Automation",
      "track": "certification",
      "language": "en",
      "startDate": "2026-10-06",
      "endDate": "2026-10-07",
      "startTime": "09:00",
      "endTime": "17:00",
      "mode": "in_person",
      "venueName": "AI365 Hub, Oval Damansara",
      "city": "Kuala Lumpur",
      "priceMyr": "3200.00",
      "hrdcClaimable": true,
      "seatsLabel": "few_seats",
      "registerUrl": "https://.../register/AIA-2610-EN"
    }
  ]
}
```

Rules:

- Only classes with `is_public=true`, status `open`/`few_seats`, `start_date >= today`.
- `seatsLabel` ∈ {available, few_seats, full} — never the raw seat count.
- `online_url`, trainer names, internal notes never in this response.
- Sorted by start_date ascending.
- Cached 5 minutes at edge; class edit purges cache (§12).
- CORS allows LEAD website origins only.

### 8.2 POST /api/public/leads

Accepts a form submission from any landing page or the website contact form.

```json
{
  "idempotencyKey": "uuid-from-the-form",
  "formName": ".01 LEAD - EN - AI Agentic Automation Interest",
  "fullName": "Tan Mei Ling",
  "email": "meiling@example.com",
  "phone": "012-345 6789",
  "companyName": "Acme Sdn Bhd",
  "jobTitle": "HR Manager",
  "preferredLanguage": "en",
  "courseInterest": "AIA",
  "classCode": "AIA-2610-EN",
  "message": "Is this HRDC claimable?",
  "consentMarketing": true,
  "hrdcIntended": false,
  "attribution": {
    "utmSource": "facebook",
    "utmMedium": "paid_social",
    "utmCampaign": "agentic_202610_leads_en",
    "utmContent": "vid_a",
    "utmTerm": null,
    "gclid": null,
    "fbclid": "IwAR...",
    "landingUrl": "https://thelead.io/lp/agentic",
    "referrer": "https://facebook.com/",
    "firstTouch": {
      "utmSource": "youtube",
      "utmCampaign": "organic",
      "occurredAt": "2026-11-02T10:15:00Z"
    }
  },
  "captchaToken": "..."
}
```

Header: `X-Api-Key: <PUBLIC_API_KEY>`.

Response 201: `{ "ok": true, "personId": "...", "dealId": "..." }` — website shows its own thank-you, must not display the IDs.

Server behaviour, in order:

1. Verify API key and CAPTCHA. Rate limit: 10/IP/min, 3/phone/hour.
2. Normalise phone and email (§4).
3. Find existing person by email_norm or phone_e164; create if none.
3a. **Company** (v1.4). If `companyName` is present, call `link_company_from_form(personId, companyName)`. It stores the text in `person.company_name_given` and links the person to a company only if they have no current company and exactly one existing company has the same normalised name. **A public form never creates a company** — typed names are too inconsistent ("Acme", "ACME Sdn. Bhd.", "Acme (M) Sdn Bhd"), and there is no company merge in MVP. Sales links or creates the company from 9.2.
4. Insert touchpoint with all attribution fields; set is_first_touch if none exists.
5. Record consent from consentMarketing.
6. Create a deal in `new` unless an open deal for the same course exists.
7. Write `LeadCaptured` to the outbox.
8. Return 201. Repeat idempotencyKey → same result, no change.

Required: only `fullName` + one of email/phone. A submission missing everything else is still captured.

Never trust the client — attribution is informational; server records landingUrl/referrer from headers where possible.

**Added 24 Sep:** `hrdcIntended` (optional boolean, default false). When true, the new deal gets `funding_type = 'hrdc'`.

### 8.3 POST /api/public/register (added 24 Sep)

`/register/<classCode>` (§10.4) needs a Stripe link without a session, so it calls this instead of the internal checkout route. Body: everything in 8.2, plus required `classCode` and `hrdcIntended`.

Server behaviour, in order:

1. Everything 8.2 does (key, CAPTCHA, rate limit, dedupe, company link, touchpoint, consent, deal).
2. Load the class by classCode. 409 `class_unavailable` if not public, not open/few_seats, or already started.
3. If `hrdcIntended`: no checkout; return `201 { next: 'hrdc_contact' }`.
4. Otherwise create a `reserved` enrolment (seat check in the transaction, 409 `no_seats` if full), create the Stripe Checkout session (Shawn's code), store it on the deal, return `201 { next: 'checkout', checkoutUrl }`.

**Price always comes from the class record on the server** — nothing in the request body can set an amount. The Stripe session carries `deal_id`, `enrolment_id`, `class_id` in metadata so the webhook can match it.

## 9. CRM Screens

17 screens, build in order below (each depends on ones above it).

**Shell.** Left sidebar: Dashboard, People, Companies, Deals, Classes, Enrolments, Enquiries, Tasks, Settings — filtered by role. Top bar: global search (name/email/phone), signed-in user, sign out. Every list screen: filter row, table, pagination, empty state, row click → detail.

**9.0 Home** (added 24 Sep) — The Dashboard link opens a work page, not analytics (charts live in the BI tool): my tasks (overdue first, then today); my open deals count + value per stage (from `stageTotals`); upcoming classes next 14 days with sold/capacity; needs attention — `needs_review` people, unmatched payments, pending class notices, each shown only to roles that can act on it; link to BI dashboards. No charts, no custom metrics.

**9.1 People list** — Columns: Name, Phone, Email, Language, Stage (computed badge), Owner, Last activity, Tags. Tags: up to 3 chips + "+2" tooltip. Last activity: relative <7 days ("3 days ago"), absolute after ("14 Aug 2026"), "—" if none. Filters: stage, owner, language, tag, has open deal, created between, needs_review. Search matches name/email/phone (normalised), debounce 300ms. Actions: Add person, Export CSV (permitted roles), bulk assign owner, bulk add tag. needs_review row → amber dot + tooltip.

**9.2 Person detail** — Header: name, preferred name, stage badge, owner, language, quick actions (WhatsApp via WATI, Email, Add task, New deal). Left: editable fields (name, preferred name, email, phone, WhatsApp, language, job title, company, owner, notes). Right (read-only): Attribution (first/latest touch), Deals, Enrolments, Payments, Enquiries, Consent, Timeline. Validation: duplicate phone/email save → 409, "already belongs to <name>" + link + Merge option. **Company** (v1.4): a picker, not free text — search existing companies, or "Create company" with the name prefilled. Saving attaches via POST /api/companies/:id/members. If the person has no current company but `company_name_given` is set, show it under the picker as "From form: <text>" with a Link button that opens the picker searched on that text.

**9.3 Merge people** — super_admin only. Side-by-side, radio buttons per field, plain-language summary of what moves. Confirm requires typing kept person's name. Irreversible — say so.

**9.4 Companies list & detail** — List: name, industry, size, HRDC registered, people count, open deals. Detail: fields, employee list w/ job title + HR/billing flags, deals, enrolments, total revenue.

**9.5 Deals board** — Two tabs: Individual / Corporate (separate pipelines, not a filter). Kanban per stage, count + summed value. Cards: person, course, value, owner initials circle, days in stage (amber >7, red >14). Drag → POST /api/deals/:id/stage. Drag to Lost → required reason dialog. Optimistic move + revert/toast on failure. Filters: owner, course, date range, funding type. "My deals" toggle, default on for sales.

**9.6 Deal detail** — Fields: pipeline, stage, person, company, course, class, headcount, amount, funding type, HRDC grant ref/dates, owner, lost reason. Actions: Send checkout link, Create enrolment, Add task, Change stage. Panels: stage history, tasks, linked enquiry. Rules: corporate deals can't leave `discovery` without company/headcount/funding type; lost requires reason; won with no enrolment prompts to create one.

**9.7 Courses** — Simple CRUD: code, names EN/ZH, track, duration, list price, HRDC claimable, active. Plain table + modal form.

**9.8 Classes list** — Operations' home screen. Columns: code, course, dates, language, mode, city/venue, capacity, sold/capacity progress bar, status, public. Default filter: upcoming only, toggle for past. Status colours: draft grey, open green, few_seats amber, full blue, cancelled red, completed grey.

**9.9 Class create/edit** — Fields per §5. Conditional: venue required unless online; online_url required unless in_person. Validation: end_date >= start_date; capacity ≥ confirmed enrolments; price optional.

Change-notice flow: date/time/venue change on class w/ confirmed enrolments → dialog "N students enrolled. They will not be told until you approve a notice." Options: Save and prepare notice (default) / Save quietly. First option creates pending notice for Operations to approve on class detail. Nothing sent directly from this screen.

**9.10 Class detail** — Header: seat summary, status. Tabs: Roster (enrolments w/ actions: add, change status, transfer, export CSV), Waitlist (if built), Notices (pending/sent, Approve & send — Operations only), Details (class fields; Cancel class = destructive, confirm dialog with count, refunds handled in Stripe).

**9.11 Enrolment detail** — Person, class, status (allowed next statuses only), payer type, booker, price paid, payments, onboarding progress, certificate number. Actions: change status, transfer (class picker w/ seats available), record manual payment.

**9.12 Record manual payment** — Modal. Fields: method (bank transfer/HRDC/invoice), amount, reference number, payment date, proof upload (image/PDF, max 10MB), notes. All required except notes. On save: creates payment, moves enrolment to confirmed, raises PaymentRecorded. Success state names what changed.

**9.13 Enquiries queue** — Columns: person, channel, category, status, assigned, first message, first response, age. Default: open, oldest first. Past-SLA rows highlighted. Actions: assign to me, set category, convert to deal, close with outcome. Opening a row shows person context beside it.

**9.14 Tasks** — My open tasks by due date, overdue at top. Inline complete. Create task from any person/deal/enrolment screen.

**9.15 Settings** — Tabbed, super_admin unless noted:

- Users — invite, set role, deactivate.
- Courses — from 9.7.
- Lost reasons — full CRUD on lost_reason table (super_admin only in MVP — there is no sales-lead role). Deactivate hides from new deals, keeps on old. No delete button.
- Tags — rename user tags, merge two into one, deactivate. System tags read-only, greyed, lock icon.
- Templates — onboarding email/WhatsApp templates, view only in MVP (Shawn edits content).
- Integrations — health panel from GET /api/health/integrations.

**9.16 Audit log viewer** — Added 22 Sep (super_admin + management read access). Read-only table: when, who, action, entity, record (link where it still exists), IP. Filters: user, entity type, action, date range. Default: last 7 days, newest first. Expand row → before/after diff (changed fields only). Paginated 50/page. No export in MVP, no delete ever.

### Cross-screen requirements

- Every destructive action: confirm dialog naming what happens + how many records touched.
- Every form: disable submit while saving, field-level errors from API response, never lose typed input on failed save.
- Every table: loading skeleton, empty state with next action, error state with retry.
- Everything keyboard-reachable; dialogs trap focus, close on Escape.

## 10. Website & Landing Pages

Three jobs: show live schedule, capture leads with attribution intact, hand paying visitors to Stripe without losing who they are.

**10.1 Schedule** — Fetch GET /api/public/schedule (§8.1), rendered server-side (indexable, fast). Cards: course, dates, time, language badge (English/中文), venue or Online, price, HRDC badge, seats label. few_seats → "Few seats left"; full → "Full" + disabled register + Join waitlist link (if built). Filters: language, track, city — client-side over fetched set. Empty state: "No public classes scheduled right now" + enquiry form. Feed failure → render last cached response, log error.

**10.2 Attribution capture** — Script on every page, before any form renders. First visit: read utm_*, gclid, fbclid, landing_url, referrer → store in first-party cookie `lead_first_touch` (90-day expiry) + `lead_last_touch` (overwritten every visit). Both sent with every submission.

Rules:

- First touch written once, never overwritten — most common implementation mistake, breaks all attribution reporting if violated.
- Cookies first-party, SameSite=Lax, no third-party storage.
- Consent banner before any marketing cookie; attribution cookies (feed only LEAD's CRM) are functional — confirm wording with PDPA review (§15).

**10.3 Forms** — Post to POST /api/public/leads (§8.2). Required: name + (phone or email). Everything else optional.

- Phone field: +60 prefix hint, accepts any local format, server normalises.
- Marketing consent checkbox, unticked by default: "Send me updates about LEAD courses by email and WhatsApp." Submitting without it still creates the lead.
- Privacy notice linked next to submit.
- CAPTCHA (invisible where possible) + honeypot field.
- Submit disabled while in flight; success replaces form with thank-you naming next step; failure keeps typed values + retry.
- Every form sends formName matching naming convention.

**10.4 Register and checkout** — `/register/<classCode>`:

1. Shows class summary + price.
2. Collects lead form fields + company + HRDC claiming intent.
3. Posts to `POST /api/public/register` (§8.3), which returns the Stripe checkout URL; redirects to it.
4. If HRDC intended: does NOT go to Stripe — submits enquiry, shows "Our team will contact you about HRDC claiming" (HRDC seats invoiced, not card-paid).

Stripe returns to `/register/thank-you?session_id=...` — confirms in plain words, says onboarding details coming by email/WhatsApp. **Must not create the enrolment** — Stripe webhook does that on Shawn's side.

**10.5 Non-negotiables**

- Mobile-first (most Malaysian traffic from FB/Instagram on mobile).
- Chinese and English pages render their own language's class names.
- No layout shift when schedule loads.
- Page weight under 1MB on landing pages.

## 11. Integration Contracts

Two sides never call each other's code — they meet at the database and the outbox. Zixuan's job: raise the right event on the right write. Shawn's job: act on it.

### 11.1 Events Zixuan must raise

Written to `event_outbox` inside the same transaction as the business write. Missing one = silent automation failure.

| Event                | Raised when                          | Payload                                   | Shawn does                               |
| -------------------- | ------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| LeadCaptured         | Person created from public form      | personId, dealId, formName, touchpointId  | Assign owner, first-contact task, notify |
| DealStageChanged     | Any stage move                       | dealId, fromStage, toStage, byUserId      | SLA tracking, notifications              |
| EnrolmentCreated     | Enrolment created, any route         | enrolmentId, personId, classId, status    | —                                        |
| EnrolmentConfirmed   | Status → confirmed                   | enrolmentId, personId, classId, language  | Starts onboarding sequence               |
| EnrolmentCancelled   | Status → cancelled                   | enrolmentId, reason                       | Releases seat, notifies Ops              |
| EnrolmentTransferred | Moved between classes                | enrolmentId, fromClassId, toClassId       | Sends transfer confirmation              |
| PaymentRecorded      | Manual payment saved                 | paymentId, enrolmentId, method, amountMyr | Reconciliation, receipt                  |
| ClassChanged         | Date/time/venue edited w/ enrolments | classId, changedFields, noticeId          | Prepares notice; sends after approval    |
| ClassNoticeApproved  | Ops approves change notice           | noticeId, classId                         | Sends to all confirmed students          |
| ClassCancelled       | Class cancelled                      | classId, reason, enrolmentIds             | Notifies students, flags refunds         |
| ClassPublished       | is_public or status changes          | classId                                   | Purges schedule cache                    |
| EnquiryConverted     | Enquiry → deal                       | enquiryId, dealId                         | Attribution                              |
| ConsentChanged       | Consent granted/withdrawn            | personId, purpose, isGranted              | Suppression lists                        |

Event names are exact — a typo is a silent failure. They live in one shared TypeScript union both sides import.

### 11.2 What Shawn writes that Zixuan reads

| Written by          | Table                                    | Zixuan's screens must tolerate                                     |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Stripe webhook      | payment, enrolment, deal                 | Enrolment appearing without user action; person created by webhook |
| WATI webhook        | person, touchpoint, enquiry, message_log | Person with no name (WhatsApp-only) — show phone as display name   |
| n8n (Meta Lead Ads) | person, touchpoint, deal                 | Same as form leads                                                 |
| Workers             | task, enrolment.onboarding_step          | Tasks appearing that nobody created by hand                        |

**Implication for UI:** any record may change underneath the user at any moment. Lists refetch on window focus. Detail screens send If-Match with the record's version (§7).

### 11.3 Unmatched payments

When Stripe sends a payment that can't be matched to a person/class, Shawn's worker creates a task of type `match_payment` holding raw details. Zixuan builds the resolution screen: show Stripe metadata, search for right person/class, confirm → `POST /api/payments/:id/match` (§7.1) creates enrolment, links payment, sets match_status = matched. Safety net for the money path — MVP, not optional.

### 11.4 Integration health

GET /api/health/integrations returns per integration: name, lastSuccessAt, lastErrorAt, lastErrorMessage, queueDepth, status (ok/degraded/down). Zixuan renders in Settings: table with coloured status dots + Retry button per failed item (posts to Shawn's endpoint).

## 12. Business Rules

Each rule lives in exactly one function in `/lib`, called by API and workers. Duplicating a rule in a React component causes app/automation disagreement.

### 12.1 Seats

```
seatsTaken = enrolments where status in
             (reserved-and-not-expired, payment_pending, confirmed,
              onboarded, attended, completed)
seatsAvailable = capacity - seatsTaken
```

Waitlisted, cancelled, refunded, no_show, transferred-away never occupy a seat. Reservation expires after 48 hours (configurable), frees seat automatically.

Status derives from seats, recomputed on every enrolment change:

| Condition                             | class_status |
| ------------------------------------- | ------------ |
| seatsAvailable <= 0                   | full         |
| seatsAvailable <= few_seats_threshold | few_seats    |
| otherwise, and published              | open         |

`draft`, `cancelled`, `completed` are set by people, never computed — they override the above.

Concurrency: seat check + enrolment insert in one transaction that locks the class row. Anything else eventually oversells a class.

### 12.2 Duplicate prevention

On every person create, any route:

1. Normalise email and phone.
2. **Hard match** — same email_norm or phone_e164 → use existing person, don't create. API create → 409 with existing record; public form silently attaches.
3. **Soft match** (revised 24 Sep) — create the person but set `needs_review = true` when the **normalised name** matches and either: (a) the company matches — `normalise_company_name(typed companyName)` equals the candidate's current company `name_norm` or `normalise_company_name(candidate.company_name_given)`; a NULL never matches (reason `possible_duplicate_company`), (b) the email local part matches at a different domain (`tan.ml@gmail.com` vs `tan.ml@acme.com`), or (c) the last 7 phone digits match.
4. **Normalised name** = lowercase, spaces/hyphens/dots/apostrophes removed. "Tan Mei Ling", "Tan Meiling" and "TAN MEI-LING" compare equal without a fuzzy-matching library.
5. **Never merge automatically, never flag on name alone.** Malaysian/Chinese names collide constantly — flagging every "Tan Wei Ming" would bury the review queue.

### 12.3 Lifecycle stage (computed, never stored as truth)

| Stage    | Condition                       |
| -------- | ------------------------------- |
| customer | ≥1 succeeded payment            |
| student  | enrolment in confirmed or later |
| lead     | everything else                 |

Shown as badge, recomputed on read. May cache for query speed, but function is source of truth.

### 12.4 Enrolment state machine

```
[*] --> reserved
reserved --> payment_pending
reserved --> waitlisted
reserved --> cancelled
waitlisted --> reserved
payment_pending --> confirmed
payment_pending --> cancelled
confirmed --> onboarded
confirmed --> transferred
confirmed --> cancelled
onboarded --> attended
onboarded --> no_show
attended --> completed
cancelled --> refunded
```

Any transition not on this diagram → 422. UI only offers legal next statuses — no free dropdown of all eleven states.

### 12.5 Deal stages

- Stage must belong to deal's pipeline. Corporate stage on individual deal → 422.
- Moving to `lost` requires `lostReasonId` referencing an **active** `lost_reason` row — a deactivated reason can't be picked for a new loss.
- Corporate deals can't pass `discovery` without company, headcount, funding type.
- Every change writes deal_stage_history + raises DealStageChanged.
- won_at/lost_at set by service, never by a form.

### 12.6 HRDC

MVP scope: fields and reminders only — no document generation, no portal automation (no HRD Corp API).

- funding_type = hrdc makes hrdc_grant_ref, hrdc_approval_date, hrdc_deadline_date visible+required before deal reaches `won`.
- HRDC enrolment stays payment_pending, not confirmed, until manual payment/approval recorded — must not count as paid revenue.
- Task type hrdc_deadline created when deal enters `funding`, due on hrdc_deadline_date.
- Grant lead time and claim window are configurable settings, not constants (guidance conflicts and changes).

### 12.7 Money

- All amounts numeric(12,2), MYR.
- price_paid_myr on enrolment is a snapshot at purchase, never follows later price changes.
- Refunds reduce refunded_amount_myr; original payment row never edited/deleted.
- Revenue = succeeded payments minus refunds — not deal values, not enrolment counts.

### 12.8 Class changes

Editing start_date, start_time, end_date, end_time, venue_name, venue_address, or online_url on a class with confirmed enrolments creates a pending notice and raises ClassChanged. Nothing reaches a student until Operations approves. Editing capacity, price, or internal notes needs no notice.

### 12.9 Last activity

Added 22 Sep. `person.last_activity_at` = last time person did something, or something happened to them a staff member would call contact.

Set to now() when:

| Trigger                                               | Why it counts             |
| ----------------------------------------------------- | ------------------------- |
| Touchpoint created (form, ad, WhatsApp, payment link) | They acted                |
| Inbound message logged                                | They acted                |
| Outbound message sent to them                         | We contacted them         |
| Enquiry created or replied to                         | Two-way contact           |
| Their deal changes stage                              | Sales moved it            |
| Enrolment created or changes status                   | Operations moved it       |
| Payment succeeds                                      | They paid                 |
| Task about them completed                             | Someone did the follow-up |

**Not** updated by: opening record, editing a field, adding a note, tag change, or import.

Implementation: one helper `touchPersonActivity(personId, tx)`, called inside same transaction as each trigger. Never a DB trigger on updated_at, never computed at read time with joins across 13,000 people.

### 12.10 Merge, erasure and deletion (added 24 Sep, v1.3)

All three are database functions in migration 002 (`lib/db/migrations/002_merge_erase.sql`, tests in `lib/db/tests/`). The API calls them; it does not re-implement them. `actor` is always the signed-in user from the session, never a value from the request body. The functions cannot be called with the publishable key.

**Merge** — `merge_person(source, target, actor)`
- Blocked if either person is merged, deleted or erased, or both have an active enrolment in the same class. The error lists the class codes; cancel or transfer one enrolment, then merge.
- Moves touchpoints, consent, deals, enrolments (as person and as booker), enquiries, messages, tasks, tags and company memberships. Shared tags are kept once; the target's current membership at a company wins.
- The earlier of the two first touchpoints becomes the only first touch.
- **Any opt-out wins.** If either person had opted out of a purpose, the kept person is opted out after the merge, even if the other opted in later.
- The pair's `review_duplicate` task is closed.
- The per-field choices from 9.3 are applied after the function returns, in the same transaction, and audit-logged.
- Irreversible. There is no unmerge.

**Erasure (PDPA)** — `erase_person(person, actor, reason)`
Anonymise, don't delete. The name becomes "Erased person". Email, phones, job title, notes, WATI/Stripe ids, message bodies, enquiry summaries, task notes and tags are cleared. Records previously merged into the person are anonymised too. Enrolments, payments, touchpoints and consent stay, so revenue, attribution and the opt-out record still add up. The email and phone are then free for a new signup. See O11–O14.

**Soft delete** — `soft_delete_person(person, actor, reason)`
For junk and test records only. Refused for anyone with an enrolment or payment; use erasure instead. The audit row stores the reason, not a copy of the record.

## 13. Errors, States & Logging

**Error messages say what happened and what to do.** Never "An error occurred", never a raw exception.

| Situation               | Message                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Duplicate phone on save | "This phone number already belongs to Tan Mei Ling. Open her record, or merge them."   |
| Class is full           | "This class is full. Add to waitlist, or choose another class."                        |
| Stale edit              | "Someone else changed this class while you were editing. Reload to see their version." |
| Illegal status jump     | "A cancelled enrolment can't be confirmed. Create a new enrolment instead."            |
| Permission denied       | "You don't have access to payments. Ask Shawn if you need it."                         |
| Upload too large        | "That file is 14MB. The limit is 10MB — try a photo instead of a scan."                |
| Network failure         | "Couldn't save — check your connection. Your changes are still here." + Retry button   |

### Required states for every screen

| State                         | Requirement                                          |
| ----------------------------- | ---------------------------------------------------- |
| Loading                       | Skeleton rows, not a spinner over blank page         |
| Empty (no data yet)           | What screen is for + action that fills it            |
| Empty (filters match nothing) | "No people match these filters" + Clear filters      |
| Error                         | What failed, Retry button, rest of app still usable  |
| Saving                        | Button spinner + disabled; form stays filled         |
| Success                       | Toast naming what happened, not just a green tick    |
| Offline                       | Banner; block saves rather than silently losing them |

Toasts last 5 seconds, dismissible, never carry the only copy of something important (e.g. a checkout link is also on the deal record).

### Logging

- Structured JSON server-side: timestamp, level, request id, user id, route, duration, outcome.
- Request id generated per request, returned in response header, shown in UI error box ("Reference: a3f9c2").
- **Never log:** passwords, session tokens, API keys, full phone numbers/emails, message bodies, uploaded file contents. PII in logs is a PDPA problem.
- Errors → Sentry with request id. 500s alert immediately; 400s do not.
- Client-side: log unhandled exceptions + failed API calls only, nothing routine.

## 14. Non-Functional Requirements

| Area          | Requirement                                                                                                        | How checked                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Page load     | CRM list screens interactive <2s on office wifi w/ 13,000 people in DB                                             | Test against seeded production-size data |
| API latency   | p95 <500ms list endpoints, <1s person detail                                                                       | Server timing logs                       |
| Schedule feed | <300ms cached, <1s cold                                                                                            |                                          |
| Search        | Results within 500ms of debounce firing                                                                            | Trigram index on name                    |
| Pagination    | Never load >100 rows at once, anywhere                                                                             | Code review                              |
| Concurrency   | Two simultaneous last-seat enrolments → exactly one confirmation                                                   | Automated test, required before go-live  |
| Uptime        | 99.5% during business hours (9am–7pm MYT, Mon–Sat)                                                                 | Uptime monitor                           |
| Backups       | Daily automated backup, 30-day retention, point-in-time recovery                                                   | **One restore rehearsed before go-live** |
| Browsers      | Latest Chrome/Edge/Safari/Firefox; Mobile Safari + Chrome Android for public site                                  |                                          |
| Screen sizes  | CRM usable ≥1280px; public site ≥360px                                                                             |                                          |
| Accessibility | Keyboard reachable, visible focus, labelled inputs, 4.5:1 contrast, dialogs trap focus. WCAG 2.1 AA on public site |                                          |
| Language      | CRM interface English. Customer-facing content in en and zh                                                        |                                          |

### Security

- HTTPS only; HSTS on.
- MFA available for every account, required for super_admin.
- Passwords hashed by auth provider — never rolled by hand.
- Rate limits: 5 failed sign-ins/account/15min; public endpoints per §8.
- Uploads: images + PDF only, 10MB max, content-type verified server-side (not by extension), private bucket, short-lived signed URLs.
- Zod validation on every endpoint; never trust a client-sent id — always check caller may touch that record.
- Parameterised queries only. No string-built SQL anywhere.
- Dependencies scanned; no known-critical vulnerabilities at go-live.
- Secrets rotate-able without a code change.

### Data protection (PDPA)

- Personal data stays in Singapore region unless transfer basis documented.
- A person's data exportable as JSON/CSV from their detail screen — portability right, law not nice-to-have.
- Soft delete everywhere; hard delete only via admin action, audit-logged. A person's erasure request is handled by anonymising (§12.10).
- No production data in staging, ever.
- Marketing consent enforced at send time by checking consent table — never by remembering a checkbox.

## 15. Done, Testing & Open Items

### 15.1 Definition of done

A screen/endpoint is done when ALL true (not when it renders):

- ☐ Matches this spec, or difference written in §15.3
- ☐ Permissions enforced server-side, verified with a second role
- ☐ Validation on client and server, sharing one zod schema
- ☐ Loading, empty, filtered-empty, error, saving states all built
- ☐ Outbox events raised where §11 requires
- ☐ Audit log written for create/update/delete
- ☐ Works at 1280px and on a phone where screen is public-facing
- ☐ Keyboard reachable with visible focus
- ☐ Tested against seeded data at production size, not a handful of rows
- ☐ Reviewed by other developer and merged to main

### 15.2 Testing

No time for full coverage in 13 weeks — test things that lose money or data:

| Must have automated tests               | Why                                                |
| --------------------------------------- | -------------------------------------------------- |
| Phone and email normalisation           | Every match depends on it                          |
| Duplicate detection                     | Wrong result = merged or split customers           |
| Seat calculation + concurrent enrolment | Oversold class = person turned away at door        |
| Enrolment state machine                 | Illegal transitions corrupt revenue reporting      |
| Stripe webhook idempotency (Shawn)      | Replayed webhook mustn't double-enrol/double-count |
| Permission checks per role              | part_time mustn't reach all 13,000 contacts        |
| Money arithmetic                        | Any rounding error compounds                       |

Everything else: manual UAT with Wei Ping, Ops and Sales during Sprint 5 (30 Nov – 11 Dec).

**Before go-live, all must pass:** full backup restore, concurrency test, Stripe test payment end-to-end from landing page, WATI message creating an enquiry, schedule feed serving live website.

### 15.3 Open items

| #   | Question                                                                                  | Blocks                 | Needed by    | Owner                  |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- | ------------ | ---------------------- |
| O1  | Google Workspace or Microsoft 365? Decides SSO                                            | §6 auth                | Sprint 1     | Shawn                  |
| O2  | Store WhatsApp message bodies, or metadata only? (PDPA)                                   | message_log.body       | Sprint 2     | Shawn + privacy review |
| O3  | Reservation expiry — 48 hours or something else?                                          | Seat logic             | Sprint 2     | Operations             |
| O4  | First-response SLA in business hours                                                      | Enquiry screen, alerts | Sprint 3     | Wei Ping               |
| O5  | Waitlist in MVP or January?                                                               | Class detail scope     | Sprint 3     | Client (pending)       |
| O6  | Refund and transfer policy in writing                                                     | Enrolment actions      | Sprint 4     | Finance                |
| O7  | HRDC grant lead time and claim window values                                              | HRDC reminders         | Sprint 4     | Finance                |
| O8  | Who owns website deploy, does Zixuan have access?                                         | §10, all of it         | **Sprint 1** | Management             |
| O9  | Corporate booking: one HR contact registering 10 staff — confirm Booker model matches Ops | Enrolment screens      | Sprint 3     | Operations             |
| O10 | Certificate numbering format                                                              | Enrolment              | January      | Operations             |
| O11 | Does anonymisation (§12.10) satisfy a PDPA erasure request? | Erase route | Sprint 2 | Shawn + privacy review |
| O12 | How long must payment and invoice records be kept? | Retention, erasure scope | Sprint 4 | Finance / accountant |
| O13 | `audit_log` rows written before an erasure still hold that person's old values (append-only). Accept, or allow a controlled redaction? | Erasure completeness | Sprint 2 | Shawn + privacy review |
| O14 | `touchpoint.landing_url` / `referrer` can carry personal data in the query string (e.g. `?email=`). Strip at capture? | Touchpoint capture, erasure | Sprint 2 | Shawn |
| O15 | Which fields can the 9.3 merge screen choose between (the `fields` map)? | Merge route validation | Sprint 1 | Zixuan + Shawn |

**Decision calendar (added 23 Sep).** Every open item now has a date. If an answer misses its date, the fallback in the last column is what gets built — nobody waits.

| # | Decide by | Who decides | Fallback if the date passes |
|---|---|---|---|
| O8 website deploy access | **Fri 25 Sep** | Management | Blocker, not a fallback — escalate the same day; Sprint 3 cannot start without it |
| O1 auth (SSO vs email+MFA) | Fri 2 Oct | Shawn | Email + password with MFA (see below) |
| O2 store message bodies | Fri 9 Oct | Shawn + privacy review | Metadata only; no bodies stored |
| O3 reservation expiry | Fri 16 Oct | Operations | 48 hours |
| O9 corporate booker model | Fri 16 Oct | Operations | Build as specified in 12.2 |
| O4 first-response SLA | Fri 30 Oct | Wei Ping | 1 business hour, configurable |
| O5 waitlist in MVP | Fri 30 Oct | Client | Defer to January |
| O6 refund/transfer policy | Fri 13 Nov | Finance | Transfer allowed to any future class; refunds handled manually in Stripe |
| O7 HRDC lead time and claim window | Fri 13 Nov | Finance | Ship as editable settings with no default; Ops fills them in |
| O10 certificate numbering | January | Operations | Out of MVP |
| O15 merge `fields` map | Fri 2 Oct | Zixuan + Shawn | The contact fields shown on 9.3: full name, preferred name, email, phone, WhatsApp, job title, language, owner |
| O11 anonymisation = erasure | Fri 9 Oct | Shawn + privacy review | Ship anonymisation as built |
| O13 audit_log history | Fri 9 Oct | Shawn + privacy review | Leave audit rows as they are; revisit in January |
| O14 personal data in URLs | Fri 16 Oct | Shawn | Keep only utm_*, gclid, fbclid and the path; drop other query parameters at capture |
| O12 payment record retention | Fri 13 Nov | Finance / accountant | Keep payment rows indefinitely; erasure never touches them |

The two that matter this week are **O8** and **O1**. O8 is the only item that can stop a whole sprint — Zixuan can't build Section 10 against a website she can't deploy to.

**Auth — decided now, so nothing waits.** Build email + password with MFA behind an auth abstraction in `/lib/auth`. If LEAD turns out to be on Google Workspace, adding Google SSO later is a provider swap and a settings change, not a rewrite. Zixuan should not hold Sprint 1 for this answer — code against the abstraction, not against a specific provider.

### 15.4 Sprint mapping

Matches Section 22 of the Blueprint.

| Sprint  | Dates           | Zixuan builds                                       | Shawn builds                                              |
| ------- | --------------- | --------------------------------------------------- | --------------------------------------------------------- |
| W1      | 28 Sep – 2 Oct  | Repo, platform, shell, auth skeleton                | Schema v1, spikes                                         |
| S1      | 5 – 16 Oct      | 9.1–9.4 People, Companies, Merge                    | Outbox, Stripe gateway. **Schema frozen 16 Oct**          |
| S2      | 19 – 30 Oct     | 9.5–9.9 Deals, Courses, Classes                     | Stripe matching, WATI intake                              |
| S3      | 2 – 13 Nov      | Section 10 website and landing pages                | Onboarding sequences, calendar, SLA alerts                |
| S4      | 16 – 27 Nov     | 9.10–9.15 Enrolments, payments, enquiries, settings | Lead Ads, data import, reporting views. **Freeze 27 Nov** |
| S5      | 30 Nov – 11 Dec | Bug fixes, polish, staff training                   | Dashboards, health panel, restore test                    |
| Go-live | 14 Dec          | Support                                             | Cutover                                                   |
