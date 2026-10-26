# LEAD CRM — Software Specification v1.25

_Last updated 26 Oct 2026 · Owner: Shawn_

## Changelog

| Version | Date | Changes |
| --- | --- | --- |
| v1.25 | 26 Oct 2026 | The Stripe webhook is built (`POST /api/webhooks/stripe`, `lib/integrations/`): hand-checked signature, reduced payload in `integration_event` (O35 text changed), `checkout.session.completed` / `expired` handlers, unmatched payments with one `match_payment` task, retry job `npm run integrations:process`, real `expireCheckoutSession()` (O36). `STRIPE_WEBHOOK_SECRET` is required (§2). New reason `checkout_expired` (§11.3, §12.1). Open items O53-O58 (§15.3). No real Stripe call has been made: the tests use a locally generated secret and a fake fetch. |
| v1.24 | 26 Oct 2026 | From Zixuan's §10.4 planning: Zixuan writes the Stripe Checkout call (`createCheckoutSession()` in `lib/payments/checkout.ts`, shared with `POST /api/deals/:id/checkout-link`) and Shawn reviews it and writes the webhook, against a session contract written into §8.3 (amount from the class record, MYR, `deal_id` / `enrolment_id` / `class_id` metadata, `expires_at` = `seat_reserved_until`, URLs from server configuration, one idempotency key per enrolment, timeout, no secrets in logs); `POST /api/public/register` takes an optional `locale` (`en` or `zh`, default `en`) used only for the success and cancel URLs; go-live gate: no live payment before the `checkout.session.completed` webhook exists (§15.2); O43 reworded. |
| v1.23 | 19 Oct 2026 | From the review of Zixuan's PR #6 (public schedule page): server code in this app reads the §8.1 feed through `readSchedule(env, query)` (`lib/public/schedule.ts`), not over HTTP to its own site, with a 5-second statement timeout and a typed query (§8.1); O38 reworded: the page keeps its own 5-minute cache tagged `public-schedule`, so a class edit refreshes the page with `revalidateTag("public-schedule")` (Zixuan's note) instead of a host purge, while the API feed's edge cache is separate (§8.1, §11.1); new O52, the open pair task left behind when a defect flag is fixed (§7.1, §12.2). |
| v1.22 | 17 Oct 2026 | O51 added at Zixuan's request: what to do with a `no_name` person who never gives a name (leave the flag, or a neutral "asked, no name given" dismiss with its own audit marker), decided once the WhatsApp intake has volume (§15). The S1 pull request (#3) is merged into `main`. |
| v1.21 | 16 Oct 2026 | From Zixuan's review of the S1 pull request: `startTime` and `endTime` in the schedule feed are `null` when a class has no time (§8.1; the type and a test now say so); O50 decided: a name edit clears a `no_name` flag, and "Not a duplicate" is refused for `no_name` and `phone_unnormalised` with 422 `not_a_pair` and hidden on 9.2 (§7, §12.2; Zixuan builds it); Environments (§2): staging and production are separate DigitalOcean databases and a developer's own database is never either of them. |
| v1.20 | 16 Oct 2026 | Shawn's decisions of 16 Oct recorded: the web app is hosted on Netlify (§2 Hosting; O38's purge call is Netlify's and still to be looked up); O49 decided, the fallback is accepted (Supabase kept for sign-in and proof-file storage only; app tables on DigitalOcean; no schema change). Not yet checked on Netlify: which header carries the client IP and whether it overwrites a spoofed one (O40, §8.2 go-live check), the DigitalOcean connection limit with one pool of 5 per serverless instance, and the same-key advisory lock behind a pooler (§8.2). The v1.18 duplicate-review wording (§7 dismiss row, §7.1, §12.2, §6, §8.2) was checked against commit 1758c22's code on 16 Oct: the dismiss row now lists 404 and 401, a typo is fixed, and one claim that the code does not back (that editing the name clears `no_name`) is replaced by the fact and a new open item, O50. |
| v1.19 | 14 Oct 2026 | Shawn's decision of 14 Oct recorded: the database and the background jobs both run on DigitalOcean, not Supabase. O48 decided: a PostgreSQL database on DigitalOcean, and a scheduled job on DigitalOcean calls `expire_reservations()` every 15 minutes (the O48 fallback); `pg_cron` and Supabase Cron are not used (§2, §12.1, §12.11, §15.3). O47 reworded: with no Supabase database there is no Data API to turn off; before go-live the database must be reachable only from the app and job hosts, require TLS, and have no table exposed through any REST layer (§14, §15.2, §15.3; date Fri 27 Nov unchanged). New open item O49, Login and file storage after the database moves: the app still signs in through Supabase Auth and stores payment proofs in Supabase Storage, so it needs a decision by Fri 16 Oct (§15.3). Whether the web app itself moves off Vercel is still not stated (§2 Hosting, O38, O42, O49). Spec text only; no code or migration changed. |
| v1.18 | 13 Oct 2026 | Shawn's decisions of 13 Oct recorded (§15.3, decision calendar): O3 reservations staff make hold 48 hours; O9 corporate Booker model built as in §12.2; O37 handler tasks stay with the duty super_admin, type `other`; O41 `message` stays in `person.notes`; O14 URL stripping applies to every capture path (only the public form captures URLs today); O45 a withdrawn consent is never re-granted from the public form; O46 accepted; O47 Supabase Data API to be turned off before go-live (checklist line in §14, §15.2). Workers move to DigitalOcean: the outbox drain runs as a scheduled job calling `drainOutbox()` (§2, §3); O40 keeps the app-level limiter and requires the client-IP header trust to be verified behind DigitalOcean's proxy before go-live (§8.2, §14, §15.2). The expiry sweep's trigger depends on where the database lives, which is not decided: new open item O48 (§12.1 and §12.11 point to it and are otherwise unchanged). Stripe test keys: Shawn will supply them (O36, O43). **Drafted from commit 1758c22 for Shawn's proofreading:** the `review_duplicate` pair task raised by a soft match (§7.1, §8.2), the soft-match review rules in §12.2 (dismiss, who may review, records flagged before pairs existed), the new `POST /api/people/:id/review/dismiss` row (§7) and the sentence in §6. No schema change. |
| v1.17 | 13 Oct 2026 | Fixes from the review of the public API and handlers. Handler tasks are assigned to the duty super_admin so Home shows them (§11.1, O37). Public form: no new consent grant when the latest row for a purpose is a withdrawal (O45); the rate-limit IP bucket is keyed with a server-only `RATE_LIMIT_SECRET`, not the API key (§2, §8.2, O42); no IP is written to `audit_log` by the public routes; same-key calls queue on a lock, so the loser of a race gets the replay, not a CAPTCHA 403; a first-touch cookie without a usable date makes no synthetic touch, and that touch does not count toward the phone limit; `classCode` attaches only classes the public schedule shows. Migration 009 stops with a count when `match_payment` tasks exist without `payment_id` (§5, §12.11). Open items O45-O47. |
| v1.16 | 13 Oct 2026 | §5 gains the schema-change tables for migrations 009 (pre-freeze schema) and 010 (outbox backoff) that were missing since v1.13; the 012 table now lists its sweep index. Derived line by line from the SQL files. Nothing else changes. |
| v1.15 | 13 Oct 2026 | Public intake API built: `GET /api/public/schedule` (§8.1) and `POST /api/public/leads` (§8.2) as specified, in `lib/public/`; migration 012 (rate-limit counter); what was decided where the spec was silent (§8.1, §8.2 "Built" notes); env variables for the public API (§2); `LeadCaptured` and `ConsentChanged` now raised by it (§11.1); a soft match on the public form raises the same §7.1 pair task as `POST /api/people` (§8.2); open items O39-O43, O38 reworded. `/register` (§8.3) is not built (O43). |
| v1.14 | 13 Oct 2026 | Decisions on six rebase questions: enrolments cannot be deleted, only cancelled; enrolment history `changed_by` stays NULL (the actor is in `audit_log`); `class.cancelled_reason` stays unenforced; Zixuan's eight hand-written outbox inserts stay (§12.11 note). O35 gap list gains `enrolment_status_history.reason` (§15.3). First outbox handlers for `EnrolmentCancelled`, `ClassCancelled` and `ClassChanged` (§3, §11.1); migration 011 `task.source_key`; open items O36-O38. |
| v1.13 | 13 Oct 2026 | S1 Shawn-side, rebased onto v1.12: event contract and outbox drain with backoff and dead letters (§2, §3, §7); pre-freeze schema migrations 009 and 010 (§12.11); nameless WhatsApp person convention (§11.2); open items O17-O19, O21, O23-O35 and O44 (§15.3; the checkout-link question was O16 until upstream took that number for part payments). O20 and O22 are closed: seats and expiry are the database's job since migrations 006 and 007. |
| v1.12 | 9 Oct 2026 | Decisions O2, O11 and O13 recorded (§15.3, decision calendar): message bodies are not stored; anonymisation ships as built with a written erasure checklist for outside systems (§12.10); old `audit_log` values stay for go-live and `audit_log` is readable by super_admin only (§6). Privacy review still to confirm all three. |
| v1.11 | 9 Oct 2026 | From Zixuan's 9.12 questions (manual payment): proof files and the private bucket, one proof per payment (migration 008, §5), part payments, late payments on confirmed enrolments, one invoice for several students, no correction route in the app (§9.12, §12.7); new open item O16 for Finance (part payments, HRDC timing). Nothing else changes. |
| v1.10 | 6 Oct 2026 | From Zixuan's class screens (commit 7ee0c7a): EnrolmentCancelled per freed seat on a class cancel, reason `class_cancelled`; ClassChanged also on "Save quietly" with `noticeId: null` (§11.1, §12.8). Cancelling a class: refused once it has started, moves only students not yet taught, expires their Stripe links (§9.10, §12.8); `onboarded → cancelled` added (§12.4); register rows (§12.11). |
| v1.9 | 6 Oct 2026 | From Zixuan's review of 006: migration 007 (every reservation has a hold; seat-guard fix) (§5, §12.1); import rule for reservations (§12.1); class has two separate controls — status and website — instead of one publish button (§9.10, §12.1); register rows (§12.11). |
| v1.8 | 5 Oct 2026 | From Zixuan's 9.8 question: seats and class status now kept by the database (migration 006, §12.1); reservation expiry is a real write every 15 minutes; Stripe-path holds 24 hours; `reserved → confirmed` added (§12.4); full classes shown on the website (§8.1); §8.3 steps 2 and 4, §9.9 validation and §11.1 events corrected; rule placement (§3) and a who-writes-what register (§12.11). |
| v1.7 | 1 Oct 2026 | From Zixuan's release notes: concurrency now uses an integer `version` instead of `updated_at` (§7, migration 005); in-place lost-reason correction (§12.5); withdrawn HRDC task closed with `done_at` (§12.6); schema-change tables for 004 and 005 (§5). |
| v1.6 | 28 Sep 2026 | From Zixuan's 9.5 review: course list via existing GET /api/courses (§7, §9.5); leaving Won/Lost rules and stage aging (§12.5); HRDC deadline task rules + migration 004 (§12.6). |
| v1.5 | 24 Sep 2026 | Companies from Zixuan's 9.4 question: Add/Edit company, Add person, edit and end memberships on 9.4; `replaceCurrent` on POST members; new PATCH members route (§7, §7.1); company decisions recorded (§15.3). |
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
| Database       | PostgreSQL on DigitalOcean (decided 14 Oct, O48), Singapore region | Section 5                                              |
| DB access      | Prisma or Drizzle — Shawn picks and owns the schema file            | Zixuan uses generated client, never raw SQL in screens |
| Auth           | Platform auth (email+password or Google SSO) with MFA available     | Section 6                                              |
| Jobs           | `drainOutbox()` in `lib/events/drain.ts` and `expire_reservations()`; two scheduled jobs on DigitalOcean (§3): `npm run events:drain` and `npm run reservations:expire` (every 15 min) | Shawn's side                                           |
| File storage   | S3-compatible bucket (receipts, HRDC documents)                     | Private bucket, signed URLs only                       |
| Email          | Transactional ESP (Resend/Postmark class)                           | Shawn's side                                           |
| Hosting        | The web app on Netlify (decided 16 Oct, v1.20); database in Singapore |                                                        |
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

**DigitalOcean (v1.21, Shawn's direction of 16 Oct).** Staging and production are two separate PostgreSQL databases on DigitalOcean, each with its own connection string and its own two scheduled jobs (§3, O48); staging holds seeded fake data only. A developer's local or dev database is their own, never the staging or production one: tests commit data (`--test-concurrency=1`), so two people on one database make both suites flaky.

### Environment variables (fixed names)

```
DATABASE_URL
AUTH_SECRET
APP_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   - older projects call it the anon key
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET - required for POST /api/webhooks/stripe (v1.25): the endpoint's signing secret, at least 16 characters. Unset or short = the route answers 503 and processes nothing (fail closed)
WATI_API_BASE / WATI_TOKEN
RATE_LIMIT_SECRET     - server-only HMAC key for the per-IP rate limit on POST /api/public/leads; at least 16 characters; must not be the API key (browsers hold that). Unset or short = that route answers 503
PUBLIC_API_KEY        - website -> CRM form intake and schedule (X-Api-Key). Several keys, comma separated, allow a rotation; each at least 16 characters; unset = the public API is closed
PUBLIC_ALLOWED_ORIGINS - LEAD website origins, comma separated (https://thelead.io). No wildcard; unset = no browser origin is allowed
PUBLIC_WEBSITE_URL    - base of the registerUrl in the schedule feed (https://thelead.io)
TURNSTILE_SECRET_KEY  - CAPTCHA check (O39). Unset = the form endpoint refuses every submission
PUBLIC_CAPTCHA_DISABLED - "true" switches the CAPTCHA off outside production, for local development only
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

**Layering rule.** Screen → API route → service function in `/lib` → database. No DB calls in React components, no business logic in components either — seat maths, dedupe, status transitions all live in `/lib` so API and workers apply the same rules. **Exception (v1.8):** a rule that must hold whoever writes the row — the app, a webhook, n8n, an import or SQL — lives in the database instead (seats and class status are the first case). §12.11 lists who writes every derived or time-based value.

**The outbox.** Every write that others might react to also inserts a row into `event_outbox` in the same transaction. Zixuan's code writes these rows; Shawn's workers read them. New application code writes them through `raiseEvent(type, aggregateId, payload, actorId)` in `lib/events/raise.ts`, which joins the caller's transaction (the deal stage move uses it; `lib/classes` and `lib/enrolments` still insert the same columns directly, which is equivalent). The database writes `ClassPublished` and the `EnrolmentCancelled` of an expired reservation itself (§12.11). The drain, a plain function `drainOutbox()` in `lib/events/drain.ts` (trigger decided 13 Oct: a scheduled job on DigitalOcean that calls it; the interval is Shawn's to set), claims rows that are due (`next_attempt_at <= now()`) and not dead, in `(next_attempt_at, seq)` order, with `FOR UPDATE SKIP LOCKED`. Each handler runs inside a savepoint; an event with no handler is closed as processed. A failure pushes `next_attempt_at` out (30 s, 2 min, 10 min, 1 h); the 5th failure sets `dead_at` (migration 010): the row stays pending and visible with `last_error`, is never claimed again, and `retryDeadEvents()` revives it. The registry holds three handlers so far (`EnrolmentCancelled`, `ClassCancelled`, `ClassChanged`, §11.1); every other type is closed with no action. The whole batch runs in one transaction, so if it rolls back, side effects already caused by earlier handlers in it repeat: handlers must be idempotent. `npm run events:drain` is the entry point the DigitalOcean job runs (it also runs it by hand); the job is not set up yet, and no HTTP route exists. A screen's write that forgets its outbox row means the automation silently never runs — events in Section 11 are acceptance criteria, not an afterthought.

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

23 tables for MVP (4 added 22 Sep, `app_setting` added 24 Sep). DDL: schema v1 (`001_schema_v1.sql`, issued 24 Sep) `002_merge_erase.sql`, `003_company_from_form.sql` (24 Sep) and `004_hrdc_task_guard.sql` (28 Sep), all in `lib/db/migrations/`. Shawn owns migrations; this is the contract Zixuan codes against. Every table has standard columns from Section 4 (`id`, `created_at`, `updated_at`, `created_by`) — not repeated below.

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

**`message_log`** — person_id, enquiry_id, channel (whatsapp, email), direction (in, out), external_message_id (unique where not null), template_name, status, sent_at, body (nullable and left empty — decided 9 Oct, v1.12: metadata only, O2. WATI keeps the conversation text; the enquiry keeps a short `summary`).

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

**Schema changes 28 Sep, migration 004 (v1.6)**

| Table | Change | Why |
| --- | --- | --- |
| task | CHECK: an `hrdc_deadline` task must have a `deal_id`; unique index: one open `hrdc_deadline` task per deal | §12.6 — the app creates the task, so the database stops duplicates |

**Schema changes 1 Oct, migration 005 (v1.7)**

| Table | Change | Why |
| --- | --- | --- |
| 15 editable tables | add `version bigint NOT NULL DEFAULT 1`; `bump_version()` trigger adds exactly 1 on every UPDATE and ignores any value the app writes | Optimistic concurrency for If-Match (§7). `updated_at` could not do this reliably. Not on `message_log`, `event_outbox`, `integration_event` (system-written) |

**Schema changes 5 Oct, migration 006 (v1.8)**

| Table | Change | Why |
| --- | --- | --- |
| class | `status` kept by triggers from seat counts; `ClassPublished` written to the outbox by trigger on any `status`/`is_public` change | Nothing recomputed status; enrolments have several writers (§12.1) |
| enrolment | `seat_reserved_until` filled for every `reserved` row; trigger refuses any write that oversells a class (`no_seats`) | One seat rule for every writer |
| functions | `class_seats_taken(class)`, `refresh_class_status(class)`, `expire_reservations()`; EXECUTE revoked from PUBLIC/`anon`/`authenticated` | One definition of a taken seat; expiry as a real write |
| app_setting | add `stripe_reservation_hours` = 24 | A Stripe Checkout link lives at most 24 hours |

**Schema changes 6 Oct, migration 007 (v1.9)**

| Table | Change | Why |
| --- | --- | --- |
| enrolment | Backfill `seat_reserved_until` = `created_at` + 48h on `reserved` rows that had none, then run the sweep once; add CHECK `enrolment_reserved_has_hold` | Rows from before 006 never expired and blocked re-booking (Zixuan's catch) |
| enrolment | Seat guard treats a missing hold as "held no seat" | In 006 such a row could gain a hold without the oversell check |
| functions | `backfill_reservation_holds()`; EXECUTE revoked from PUBLIC/`anon`/`authenticated` | Used once by the migration |

**Schema changes 9 Oct, migration 008 (v1.11)**

| Table | Change | Why |
| --- | --- | --- |
| payment | Unique index `payment_proof_key_uq` on `proof_file_key` where not null | One proof file belongs to one payment; a double-click or retry on 9.12 cannot save it twice. If the index fails to build, two existing payments share a file and a person decides which is real |

**Schema changes 8 Oct, migration 009 (v1.13)** — pre-freeze review of 8 Oct, open items O23-O30, O32, O33 (§15.3)

| Table | Change | Why |
| --- | --- | --- |
| task | CHECK `task_done_by_needs_done_at`: `done_by` set needs `done_at` set, not the other way round (replaces 001's `(done_at IS NULL) = (done_by IS NULL)`) | O33 — a worker (system actor, no user) can close a task; who closed it stays in `audit_log` |
| task | add `payment_id uuid → payment`; CHECK `task_match_payment_needs_payment`; unique index `task_match_payment_open_uq` on `payment_id` where `type = 'match_payment'` and `done_at IS NULL` | O23 — the match route finds the task it must close; a second webhook cannot open a second task for one payment. The migration stops with a count if `match_payment` tasks already exist (the column is new, so none can have a payment) |
| task | add `is_cancelled boolean NOT NULL DEFAULT false`; CHECK `task_cancelled_is_closed` (`is_cancelled` implies `done_at`) | O32 — a withdrawn task is closed and flagged, so the timeline says "withdrawn"; `done_at IS NULL` still means open everywhere |
| payment | add `refunded_at timestamptz`; CHECKs `payment_paid_at_when_paid` (succeeded, partially_refunded, refunded need `paid_at`), `payment_refund_matches_status` (status agrees with `refunded_amount_myr`), `payment_refunded_at_when_refunded` (`refunded_at` set exactly when something was refunded); unique index `payment_stripe_session_uq` on `stripe_checkout_session_id` where not null | O25 — a payment cannot contradict itself; the webhook looks the payment up by session |
| view `payment_net` | new: payments in succeeded, partially_refunded or refunded, with `net_myr` = amount − refunded | O25 — the one revenue definition (§12.7); lifecycle, company totals and BI read it |
| new `enrolment_status_history` | `enrolment_id`, `from_status` (NULL on insert), `to_status`, `reason`, `changed_by` (always NULL, v1.14), `changed_at` (`clock_timestamp()`); index on `(enrolment_id, changed_at)`; append-only (`forbid_change()`); function `enrolment_log_status()` and AFTER triggers `enrolment_log_status_insert` and `enrolment_log_status_update` (status changes only) on `enrolment`; one backfill row per existing enrolment | O26 — written by the database, so the status screen, the Stripe webhook, imports, `expire_reservations()` and a class cancel are all covered. The 24th table. The enrolment foreign key means an enrolment can no longer be deleted (§12.11) |
| class | add `notes`, `cancelled_reason`, `cancelled_at`; function and trigger `class_stamp_cancelled` stamp `cancelled_at` when status is cancelled; CHECK `class_cancelled_at_recorded` | O27 — `notes` is internal (the public feed never selects it); `cancelClass()` writes the reason; no CHECK on the reason (v1.14) |
| deal | add `hrdc_document_key text`; add `source_touchpoint_id uuid → touchpoint` | O27 (HRDC document), O30 (attribution; set by public intake, n8n and WATI) |
| enrolment | partial index `enrolment_reservation_expiry_idx` on `seat_reserved_until` where `status = 'reserved'` | O28 — the scan of `expire_reservations()`; the hold CHECK itself is 007 |
| touchpoint | add `external_ref text`; unique index `touchpoint_external_ref_uq` on `(channel, external_ref)` where not null | O29 (O31) — `<batch>:<row>`, `leadgen_id`, the WATI message id or the form's `idempotencyKey`; insert with `ON CONFLICT DO NOTHING`. The new column is frozen like the rest (`forbid_change()` covers it) |

Backfills in 009: `payment.paid_at` = `created_at` where missing on paid rows; `payment.refunded_at` = `updated_at` where something was refunded; one history row per enrolment (reason "migration 009 backfill"); cancelled classes get reason "migration 009 backfill" and `cancelled_at` = `updated_at`. The migration stops with a count, and repairs nothing, if a payment's status and refunded amount disagree or two payments share a Checkout session id.

**Schema changes 9 Oct, migration 010 (v1.13)** — open item O34

| Table | Change | Why |
| --- | --- | --- |
| event_outbox | add `next_attempt_at timestamptz NOT NULL DEFAULT now()`; add `dead_at timestamptz`; CHECK `event_outbox_dead_is_pending` (a row cannot be dead and processed) | A failed row waits until `next_attempt_at` instead of burning all 5 attempts in milliseconds; "dead" is a column, not a constant in the code. A dead row stays pending and visible; retry clears `dead_at` |
| event_outbox | add `seq bigint GENERATED ALWAYS AS IDENTITY`; existing rows numbered in `(created_at, id)` order | `created_at` ties inside one transaction; claim order is `(next_attempt_at, seq)` |
| event_outbox | index `event_outbox_pending_idx` replaced by `event_outbox_due_idx` on `(next_attempt_at, seq)` where `processed_at IS NULL AND dead_at IS NULL` | The drain scans live pending rows only |
| integration_event | add `attempts integer NOT NULL DEFAULT 0` and `next_attempt_at`; index `integration_event_due_idx` on `next_attempt_at` where `status IN ('received', 'failed')` | The same retry columns for webhook staging (nothing uses them yet) |

Backfill in 010: pending rows with `attempts >= 5` get `dead_at = now()`; nothing is deleted or reset.

**Schema changes 13 Oct, migration 011 (v1.14)**

| Table | Change | Why |
| --- | --- | --- |
| task | add `source_key text`; unique index `task_source_key_uq` where not null | A handler that runs twice for one event must not open a second task (§11.1); stays unique after the task is done |

**Schema changes 13 Oct, migration 012 (v1.15)**

| Table | Change | Why |
| --- | --- | --- |
| new `rate_limit_hit` (unlogged) | `(bucket, window_start)` primary key, `hits`; function `rate_limit_take(bucket, window_seconds)` counts one hit and returns the total; index `rate_limit_hit_window_idx` on `window_start`; rows older than an hour are swept by the next call; EXECUTE revoked from PUBLIC/`anon`/`authenticated` | 10 requests per IP per minute on the public API (§8.2) needs a counter that works on serverless. The bucket is a hash of the IP keyed with the server-only `RATE_LIMIT_SECRET`, never the address. Not a business table; not counted in the 24 |

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
| audit_log         | R           | —          | —              | —       | —       | —           | —         |

¹ Marketing sees person records with phone/email masked (`012-•••• 6789`, `s••••@gmail.com`), no export.
² Sales sees payments only on deals they own.
³ Operations can record a manual payment but cannot refund — refunds are super_admin only, in Stripe, then reconciled.

**Implementation.** One helper used by every route: `requirePermission(session, 'enrolment', 'write', { recordOwnerId })` → throws 403, client renders standard "no access" screen. `part_time` "assigned only" is enforced at the query level (`WHERE assigned_user_id = :me`), not by filtering after fetch — no path to page through all 13,000 contacts.

Masking happens server-side — Marketing's API responses contain masked strings only, real values never reach that browser.

**What "assigned" means per resource (added 24 Sep).** A part-timer can see: enquiries and tasks where `assigned_user_id` is them; people they own (`owner_user_id`) or who have an enquiry or task assigned to them; companies of those people.

**Part-timers may create people, but only as part of an enquiry.** Their Add person creates the person plus an open enquiry assigned to them in one transaction, so they keep sight of the record. `owner_user_id` stays empty so sales assignment works normally. No standalone Add person button on the People list for part-timers.

**"Propose" and "request" are tasks (added 24 Sep).** No new routes:

- **Merge proposal** (sales, support, operations): `POST /api/tasks` with `type = 'review_duplicate'`, `person_id` + `related_person_id`, assigned to a super_admin, who resolves it with the 9.3 merge screen. A soft match (§12.2 rule 3) raises the same task by itself, so a flagged person always has the pair to open (§7.1). The roles that may work a flagged person (clear the flag, §12.2) are those with person write other than the assigned-only kind: super_admin, sales and support. Operations reads people, so it cannot (`canReviewFlagged()`; the 9.0 needs-attention panel uses the same test).
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
| POST /api/people/:id/review/dismiss           | "Not a duplicate" (v1.18)        | Zixuan | super_admin, sales, support (§6). Header `If-Match: <version>`; body `{note?}` (max 2000 characters, goes to the audit row only). Clears `needs_review` and `needs_review_reason` and closes the pair's `review_duplicate` task in one transaction; 204. 422 `not_flagged` if the person is no longer flagged; 422 `not_a_pair` if the flag is `phone_unnormalised` or `no_name` (no pair was proposed, §12.2; v1.21); 404 `not_found`; 409 `stale_edit`; 428 without a valid If-Match; 401 when signed out; 403 for other roles. §12.2 |
| GET/POST/PATCH /api/companies[/:id]           | Company CRUD                     | Zixuan | Write: super_admin, sales, support (§6). No DELETE in MVP (§15.3)                         |
| POST /api/companies/:id/members               | Attach person                    | Zixuan | body `{personId, jobTitle, isHrContact, isBillingContact, replaceCurrent?}`. `replaceCurrent: true` (used by the 9.2 picker) ends the person's other current memberships with `end_date` = today in the same transaction. 409 if already a current member here |
| GET /api/deals                                | Pipeline board + list            | Zixuan | filter[pipeline], filter[stage], filter[owner]                                           |
| POST /api/deals                               | Create                           | Zixuan |                                                                                          |
| PATCH /api/deals/:id                          | Update fields                    | Zixuan |                                                                                          |
| POST /api/deals/:id/stage                     | Move stage                       | Zixuan | body `{toStage, lostReasonId?}`; writes history + outbox event; 422 if lost without an active reason |
| POST /api/deals/:id/checkout-link             | Generate Stripe link             | Shawn  | Returns `{url}` and stores it on the deal (§7.1); Zixuan calls from deal screen; uses the shared `createCheckoutSession()` (§8.3, v1.24); parked, see below |
| GET/POST/PATCH /api/courses[/:id]             | Course catalogue                 | Zixuan | GET readable by every role that reads deals (§6). Optional `?active=true` (v1.6). Used for the 9.5 course filter and the deal course picker — no separate options route |
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
| POST /api/webhooks/stripe, /wati              | Inbound webhooks                 | Shawn  | No session; signature-verified. **Stripe built (v1.25):** raw body (256 KB cap, else 413); `Stripe-Signature` checked with HMAC-SHA256 in constant time and a 5-minute replay window (else 400 with no body); secret unset = 503. Stores a reduced event in `integration_event`, processes it inline, answers 200 (a replay and an unknown type also get 200). `/wati` not built |

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
| PATCH /api/companies/:id/members/:membershipId | Edit or end a membership (v1.5) | Zixuan | body `{jobTitle?, isHrContact?, isBillingContact?, endDate?}`; same roles as company write. `endDate` ends it (not before `start_date`); rows are never deleted. Ending is one-way — to rejoin, POST a new membership |
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

- **The `review_duplicate` task (v1.18, from commit 1758c22).** POST /api/people and the public form (§8.2), on a soft match (§12.2 rule 3), insert the person and a task in the same transaction: `type = 'review_duplicate'`, `person_id` the new person, `related_person_id` the candidate, `assigned_user_id` the duty super_admin (the longest-serving active one, as for the handler tasks in §11.1), `due_at` now (due today), title "Possible duplicate of <candidate name>", `created_by` the signed-in user (NULL from the public form). One `audit_log` row records the task. If no active super_admin exists the task is raised unassigned rather than not at all. A hard match creates no person, and `phone_unnormalised` and `no_name` flag a defect in one record, so none of them raises a task. No schema change: `task.related_person_id` and `merge_person()` closing the pair's task already exist (migrations 001, 002). The pair is read back from the open task by either end; if the other record has since been merged away, deleted or erased, no pair is shown. GET /api/people/:id returns it as `duplicateOf: {id, fullName} | null`.
- GET /api/deals also returns `stageTotals: [{stage, count, totalMyr}]` over the whole filtered set (not the current page). Board headers use it.
- PATCH /api/classes/:id takes optional `notice: 'prepare' | 'skip'`. If the edit touches a notice field on a class with confirmed enrolments and `notice` is absent → **409 `notice_decision_required`** with `{recipientCount}`, nothing saved. UI shows the 9.9 dialog and resubmits with the choice. The server decides whether a notice is needed, never the client.
- POST /api/deals/:id/checkout-link stores `checkout_url`, `checkout_session_id`, `checkout_sent_at` on the deal as well as returning it.
- POST /api/deals/:id/checkout-link creates a `reserved` enrolment (as §8.3), charges the class price (`class.price_myr`, else `course.list_price_myr`), individual non-HRDC deals with a class only; `deal.amount_myr` never reaches Stripe. **Status: parked until Stripe test keys exist.**

**Concurrency** (revised 1 Oct, v1.7). Every editable table has an integer `version` (migration 005) that the database raises by exactly 1 on every update; the app cannot set it. GET on a record returns `version`. PATCH sends `If-Match: <version>`; the server runs `UPDATE … WHERE id = $1 AND version = $2`. 0 rows → look the row up: gone → 404, otherwise 409, and the client shows "someone else changed this record — reload". Missing header → 428. Any update bumps the version, including system ones (for example `last_activity_at` when a message arrives), so an open form can conflict with a background change — that is expected, not a bug. A merge also bumps the survivor.

**Why not `updated_at` (v1.3–v1.6 used it).** Tested on PostgreSQL 16 on 1 Oct: the string form with full microseconds matches, but a value that has passed through a JS `Date` keeps milliseconds only and silently matches nothing (Zixuan's catch). Comparing `updated_at::text` instead depends on the session timezone and drops trailing zeros. `updated_at` is also set from `now()`, the transaction start time, so two writes in one transaction leave it unchanged. This replaces `If-Unmodified-Since`, which works in whole seconds and would miss two edits in the same second.

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

- Only classes with `is_public=true`, status `open`/`few_seats`/`full`, `start_date >= today`. Full classes are listed and shown as "Full" (§10.1) — decided 5 Oct.
- `seatsLabel` ∈ {available, few_seats, full}; status `open` → `available` — never the raw seat count.
- `online_url`, trainer names, internal notes never in this response.
- `startTime` and `endTime` are `null` when the class has no time yet (§5 makes both optional); the website must show the date alone then (v1.21).
- Sorted by start_date ascending.
- Cached 5 minutes at edge (`Cache-Control: public, s-maxage=300`). A class edit does not purge this edge copy (O38).
- **In-app readers (v1.23).** Server code in this app, such as the §10.1 schedule page, calls `readSchedule(env, query)` in `lib/public/schedule.ts`: the same allow-list, filter validation and `registerUrl` rule as the route, with no HTTP hop, no API key, no CORS and no `APP_BASE_URL`. The query is cut off after 5 seconds (`statement_timeout`, transaction-local, so the shared pool and the job scripts are not affected). A bad filter is a type error and throws at run time. `limit` defaults to 50 and the cap is 100 (§14): a caller that wants the whole schedule passes `limit: 100`, and a schedule longer than 100 upcoming public classes would be cut. Not for browsers: it reads the database. The page keeps its own 5-minute cache (Zixuan: `unstable_cache`, `revalidate: 300`, tag `public-schedule`); whether Netlify keeps that cache across serverless instances is not checked.
- CORS allows LEAD website origins only.

**Built (v1.15)** — `lib/public/schedule.ts`, `lib/public/handlers.ts`, route `app/api/public/schedule/route.ts`. Decisions where the spec was silent:

- **Key.** `X-Api-Key` is required on this route too (§8 intro says the API is key-protected). The feed is public by design, so a copy cached at the edge may be served without the key; nothing in it is private (O42).
- **Cache.** `Cache-Control: public, s-maxage=300`. Errors are `no-store`. There is no purge: a class edit shows within 5 minutes, and the `ClassChanged` handler stays a no-op (O38).
- **Filters.** `language` en/zh; `track` one of the six course tracks; `city` matched case-insensitively and exactly; `limit` 1-100, default 50 (§14: never more than 100 rows). A bad value is 400 `validation_failed`, not an empty list.
- **Today** is the date in Asia/Kuala_Lumpur; a class starting today is listed. Order: `start_date`, `start_time`, `code`.
- **Fields.** `courseName` is the Chinese name for a `zh` class when the course has one, else English. `priceMyr` is the class price, else the course list price, as a string with two decimals. An online class has `venueName` and `city` null. `registerUrl` is `PUBLIC_WEBSITE_URL` + `/register/<code>`, or null when that is unset. The response is built from a fixed list of columns, so `online_url`, trainers, notes, capacity and seat counts cannot reach it; the tests assert on the serialised body.

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

**Built (v1.15)** — `lib/public/leads.ts`, `lib/public/guard.ts`, `lib/validation/public.ts`, route `app/api/public/leads/route.ts`, migration 012. Order in the code: origin, key, `RATE_LIMIT_SECRET` check, 10/IP/min, body size and validation, then (for a call with an `idempotencyKey`) a lock and the replay lookup, CAPTCHA, 3/phone/hour, and the transaction (steps 2-7). Everything after the key check runs in one try/catch. Decisions where the spec was silent:

- **Key and origin.** `X-Api-Key` compared in constant time (both sides hashed first); several keys allowed for rotation; unset or short = 503, never open. A request with an `Origin` header not on `PUBLIC_ALLOWED_ORIGINS` is 403; no `Origin` (a server call) is allowed with a valid key. Preflight is answered for listed origins only.
- **CAPTCHA.** An injectable verifier. Default: Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set (O39), otherwise every submission is refused. `PUBLIC_CAPTCHA_DISABLED=true` switches it off outside production only. A failure of the check itself counts as failed.
- **Rate limits.** 10/IP/min in `rate_limit_hit` (migration 012, fixed one-minute window, so a burst can reach twice the limit across a window edge); 3/phone/hour counted from the person's `web_form` touchpoints in the last hour, no table. Both 429 with `Retry-After`. A replayed call counts for neither and needs no new CAPTCHA token. The IP bucket is an HMAC of the address keyed with `RATE_LIMIT_SECRET` (server-only, at least 16 characters; unset or short = 503 on this route), not with the API key, which browsers hold; the keyed hash is still a pseudonym and lives at most an hour. The public routes write no IP to `audit_log` (append-only, not erasable) or to a log. The phone count skips the cookie's synthetic first touch (see Touchpoint). The IP comes from `x-real-ip`, then `x-forwarded-for`, which is only sound behind a proxy that overwrites both. The workers move to DigitalOcean; whether its proxy or load balancer overwrites these headers has not been checked and must be verified before go-live (O40, §14, §15.2).
- **Idempotency.** The key is stored as `touchpoint.external_ref` (channel `web_form`, O31). A replay returns 201 with the same `personId` and `dealId` and writes nothing. Two calls with one key at once: the key takes a transaction-level advisory lock, so the second waits, then finds the first's committed result and answers with it without a CAPTCHA check (a Turnstile token works once, so checking it first would refuse the loser although the lead was saved). One pooled database connection is held while the CAPTCHA provider answers (5 s at most). The key is optional; without it each call is a new submission. A reused key with a different body or from a different visitor returns the first result (known gap, accepted 13 Oct; O46).
- **Person.** Found by the CRM's own hard-match rule (§12.2); a soft match creates the person flagged for review and, as `POST /api/people` does (commit 1758c22), raises the same §7.1 `review_duplicate` task in the same transaction (`person_id` the new person, `related_person_id` the match, assigned to the duty super_admin, due today; `created_by` and the audit actor NULL because no user is signed in); an unnormalisable phone is stored and flagged (§4). An existing person's fields are never changed, so a new email or phone given by a known person is not added (O41, decided 13 Oct). `created_by` is null. Each created person and deal gets an `audit_log` row with no personal data in it.
- **Touchpoint.** All attribution fields; `landing_url` is the body's value only if its origin is on the allow-list, else the `Referer` header; both, and `referrer`, are cut down to the path plus `utm_*`, `gclid`, `fbclid` (the O14 rule, decided 13 Oct). Lengths are capped by the schema. If the person has no touchpoint yet and `firstTouch` names a different source or campaign, `firstTouch` becomes the first touch (its own touchpoint, dated by the cookie, never later than the database clock, and made only if the cookie carries a date that is not more than a minute in the future or over 400 days old) and this submission is a later one; otherwise, including when the date is missing or invalid, this submission is the first touch. The cookie's touchpoint is marked in `external_ref` and does not count toward 3/phone/hour.
- **Message.** There is no column for `message`; it is appended to `person.notes` (O41, decided 13 Oct: no new column).
- **Consent.** A ticked box writes `marketing_email` and `marketing_whatsapp` grants (source `web_form`) unless already granted, and raises `ConsentChanged` for each. An unticked box writes nothing: it is the form's default, not a withdrawal (absence of a row already means no consent, §14). A ticked box never re-grants a purpose whose latest row is a withdrawal: nothing is recorded for it, the lead is still captured (O45, decided 13 Oct: opt-in again only through Ops, or a future double opt-in that is not built).
- **Deal.** Individual pipeline, stage `new`, no owner, `funding_type` `hrdc` or empty, `source_touchpoint_id` set (O30). The class comes from `classCode`, else the course from `courseInterest` (codes matched case-insensitively; unknown codes, and classes the schedule does not show (not public, or status not open / few_seats / full), are ignored: the lead is still captured, the deal has no class). "Open deal for the same course" = this person has a deal not won/lost and not deleted with the same `course_id` (both empty counts as the same); that deal is reused, nothing is created, and `hrdcIntended` does not change it.
- **Outbox.** `LeadCaptured` is raised for every accepted submission, new deal or not, in the transaction. The payload is the §11.1 one, so a worker can tell the deal was an existing one only by its age.
- **Errors.** 400 `validation_failed` (with `fields`), 400 `invalid_json`, 401 `unauthorized`, 403 `origin_not_allowed`, 403 `captcha_failed`, 413 `payload_too_large` (32 KB), 429 `rate_limited`, 503 `not_configured`, 500 `server_error`. An unexpected error logs only the error name and code, never the body.

### 8.3 POST /api/public/register (added 24 Sep)

`/register/<classCode>` (§10.4) needs a Stripe link without a session, so it calls this instead of the internal checkout route. Body: everything in 8.2, plus required `classCode` and `hrdcIntended`, and an optional `locale` (`en` or `zh`, default `en`; v1.24). `locale` is used only to pick the Stripe `success_url` and `cancel_url` (the English or the `/zh` thank-you page); it is not stored and is not passed to the lead capture. Any other value is 400 `validation_failed`.

Server behaviour, in order:

1. Everything 8.2 does (key, CAPTCHA, rate limit, dedupe, company link, touchpoint, consent, deal).
2. Load the class by classCode. 409 `class_unavailable` if not public, status `draft`/`cancelled`/`completed`, or already started. Seats are **not** judged here — the stored status can lag up to 15 minutes after a reservation expires; step 4 decides.
3. If `hrdcIntended`: no checkout; return `201 { next: 'hrdc_contact' }`.
4. Otherwise create a `reserved` enrolment with `seat_reserved_until` = now + `stripe_reservation_hours` (seat check in the transaction; the database raises `no_seats` → 409 `no_seats` if full), create the Stripe Checkout session (`createCheckoutSession()`, see the session contract below) with `expires_at` set to the same time, store it on the deal, return `201 { next: 'checkout', checkoutUrl }`.

**Not built (v1.15); Zixuan starts it on 26 Oct (v1.24).** The route needs a Stripe Checkout session; she builds and tests it against a test key from her own Stripe account (O43). Steps 1-2 are the same code as `/leads`.

**Price always comes from the class record on the server** — nothing in the request body can set an amount. The Stripe session carries `deal_id`, `enrolment_id`, `class_id` in metadata so the webhook can match it.

**Who writes the Stripe call, and the session contract (v1.24, decided 26 Oct).** Zixuan builds `createCheckoutSession()` in `lib/payments/checkout.ts`: one function over Stripe's REST API with no new dependency, injected into the route the way the CAPTCHA verifier is, with a fake for the tests. The same function serves `POST /api/deals/:id/checkout-link` (§7). Shawn reviews it and writes the webhook (§11.3) against the metadata below; either side may replace the implementation later without changing the route. The function must:

- take the amount from the class record on the server (`class.price_myr`, else `course.list_price_myr`), never from a request, and charge in MYR;
- put `deal_id`, `enrolment_id` and `class_id` in the session metadata (the webhook reads exactly these names);
- set `expires_at` to the enrolment's `seat_reserved_until`, which is within Stripe's 24-hour maximum (`stripe_reservation_hours`);
- build `success_url` and `cancel_url` from server configuration (`APP_BASE_URL` plus the `locale` page), never from the request;
- send one idempotency key per enrolment, so a retry never creates a second session;
- time out (a few seconds) and fail the request, not hang it;
- never log a key, a session secret or the customer's details.

Keys: a test key from Zixuan's own Stripe account covers building and testing everything up to the redirect back. Shawn's keys (O43) are for the webhook and the end-to-end go-live test. No key is ever committed.

**Limit until the webhook exists.** Without Shawn's `checkout.session.completed` webhook (§11.3), a paid enrolment stays `reserved` and expires after 24 hours, which frees its seat although the payment succeeded. That is acceptable on test keys and is a go-live gate (§15.2).

## 9. CRM Screens

17 screens, build in order below (each depends on ones above it).

**Shell.** Left sidebar: Dashboard, People, Companies, Deals, Classes, Enrolments, Enquiries, Tasks, Settings — filtered by role. Top bar: global search (name/email/phone), signed-in user, sign out. Every list screen: filter row, table, pagination, empty state, row click → detail.

**9.0 Home** (added 24 Sep) — The Dashboard link opens a work page, not analytics (charts live in the BI tool): my tasks (overdue first, then today); my open deals count + value per stage (from `stageTotals`); upcoming classes next 14 days with sold/capacity; needs attention — `needs_review` people, unmatched payments, pending class notices, each shown only to roles that can act on it; link to BI dashboards. No charts, no custom metrics.

**9.1 People list** — Columns: Name, Phone, Email, Language, Stage (computed badge), Owner, Last activity, Tags. Tags: up to 3 chips + "+2" tooltip. Last activity: relative <7 days ("3 days ago"), absolute after ("14 Aug 2026"), "—" if none. Filters: stage, owner, language, tag, has open deal, created between, needs_review. Search matches name/email/phone (normalised), debounce 300ms. Actions: Add person, Export CSV (permitted roles), bulk assign owner, bulk add tag. needs_review row → amber dot + tooltip.

**9.2 Person detail** — Header: name, preferred name, stage badge, owner, language, quick actions (WhatsApp via WATI, Email, Add task, New deal). Left: editable fields (name, preferred name, email, phone, WhatsApp, language, job title, company, owner, notes). Right (read-only): Attribution (first/latest touch), Deals, Enrolments, Payments, Enquiries, Consent, Timeline. Validation: duplicate phone/email save → 409, "already belongs to <name>" + link + Merge option. **Company** (v1.4): a picker, not free text — search existing companies, or "Create company" with the name prefilled. Saving attaches via POST /api/companies/:id/members. If the person has no current company but `company_name_given` is set, show it under the picker as "From form: <text>" with a Link button that opens the picker searched on that text.

**9.3 Merge people** — super_admin only. Side-by-side, radio buttons per field, plain-language summary of what moves. Confirm requires typing kept person's name. Irreversible — say so.

**9.4 Companies list & detail** — List: name, industry, size, HRDC registered, people count, open deals. Detail: fields, employee list w/ job title + HR/billing flags, deals, enrolments, total revenue.

*Write controls (v1.5)* — for super_admin, sales and support (§6); hidden for other roles.
- **Add company** (list): legal name (required), registration no., industry, size, HRDC registered, billing address, billing email, owner. Before saving, show "Similar companies" — same `name_norm` (from `normalise_company_name()`), or same registration no. ignoring case, spaces and hyphens. A warning with links, not a block.
- **Edit** (detail): the same fields.
- **Add person** (employee list): search existing people → POST /api/companies/:id/members. Creating a new person happens on 9.1, not here.
- **Per employee row**: edit job title and HR/billing flags; **End membership** asks for an end date (default today) → PATCH …/members/:membershipId.
- Ended memberships move to a collapsed "Past employees" list.
- No delete and no company merge in MVP (§15.3).

**9.5 Deals board** — Two tabs: Individual / Corporate (separate pipelines, not a filter). Kanban per stage, count + summed value. Cards: person, course, value, owner initials circle, days in stage (amber >7, red >14). Drag → POST /api/deals/:id/stage. Drag to Lost → required reason dialog. Optimistic move + revert/toast on failure. Filters: owner, course, date range, funding type. "My deals" toggle, default on for sales. **(v1.6)** Course filter lists all courses from GET /api/courses, inactive ones marked "(inactive)", so deals on a retired course can still be found; the course picker on a new/edited deal shows active courses only (`?active=true`). Dropping a card back on its own column is not a move: no API call, no history row, no reset of days in stage.

**9.6 Deal detail** — Fields: pipeline, stage, person, company, course, class, headcount, amount, funding type, HRDC grant ref/dates, owner, lost reason. Actions: Send checkout link, Create enrolment, Add task, Change stage. Panels: stage history, tasks, linked enquiry. Rules: corporate deals can't leave `discovery` without company/headcount/funding type; lost requires reason; won with no enrolment prompts to create one.

**9.7 Courses** — Simple CRUD: code, names EN/ZH, track, duration, list price, HRDC claimable, active. Plain table + modal form.

**9.8 Classes list** — Operations' home screen. Columns: code, course, dates, language, mode, city/venue, capacity, sold/capacity progress bar, status, public. Default filter: upcoming only, toggle for past. Status colours: draft grey, open green, few_seats amber, full blue, cancelled red, completed grey.

**9.9 Class create/edit** — Fields per §5. Conditional: venue required unless online; online_url required unless in_person. Validation: end_date >= start_date; capacity ≥ seats taken (`class_seats_taken`, §12.1 — reservations and pending payments hold seats too, v1.8); price optional. Status is shown, never computed on screen.

Change-notice flow: date/time/venue change on class w/ confirmed enrolments → dialog "N students enrolled. They will not be told until you approve a notice." Options: Save and prepare notice (default) / Save quietly. First option creates pending notice for Operations to approve on class detail. Nothing sent directly from this screen.

**9.10 Class detail** — Header: seat summary, status, and two controls (v1.9, §12.1): **Open for booking / Back to draft** and **Show on website / Hide from website**. Tabs: Roster (enrolments w/ actions: add, change status, transfer, export CSV), Waitlist (if built), Notices (pending/sent, Approve & send — Operations only), Details (class fields; Cancel class = destructive, confirm dialog with count, refunds handled in Stripe; not offered once the class has started — §12.8, v1.10).

**9.11 Enrolment detail** — Person, class, status (allowed next statuses only), payer type, booker, price paid, payments, onboarding progress, certificate number. Actions: change status, transfer (class picker w/ seats available), record manual payment.

**9.12 Record manual payment** — Modal. Fields: method (bank transfer/HRDC/invoice), amount, reference number, payment date, proof upload (image/PDF, max 10MB), notes. All required except notes. On save: creates payment, moves enrolment to confirmed (see rules below), raises PaymentRecorded. Success state names what changed.

Rules added 9 Oct (v1.11), from Zixuan's questions:
- **Proof storage.** A private bucket (`PAYMENT_PROOF_BUCKET`, set per environment), no public access. `proof_file_key` is an opaque key; the storage provider sits behind one file, so moving from Supabase Storage to another provider changes that file and the environment variables, not the schema. Shawn creates the bucket.
- **One proof, one payment.** The same `proof_file_key` cannot be saved on two payments (unique index, migration 008). A repeat submit fails with the index name; show "already recorded", not an error page.
- **Amount.** Any amount above zero is accepted. The modal notes a difference from `price_paid_myr`.
- **Part payments (pending Finance, O16).** Build as: the enrolment moves to `confirmed` only when succeeded payments on it total at least `price_paid_myr`; below that it stays `payment_pending` and the modal shows the balance. The total-versus-price check must apply to every writer, Stripe webhook included, so it goes in the database, not in `/lib` (§3). It is not built until Finance answers.
- **Status.** The save moves an enrolment to `confirmed` only from `reserved` or `payment_pending` (§12.4). On an enrolment already `confirmed` or `onboarded`, for example a late bank transfer, the payment is recorded and the status is left alone. `cancelled`, `refunded` and `transferred` enrolments are refused.
- **HRDC (pending Finance, O16).** Record an HRDC payment only when the money has arrived, with `paid_at` as the date received. An HRDC approval with no money yet is a different action and is not in the MVP; the enrolment stays `payment_pending` (§12.6).
- **One invoice, several students.** The modal records one payment against one enrolment (plus its `deal_id`). A corporate invoice for ten students is ten payments sharing the same `reference_no` and `deal_id`. A single payment split across enrolments is a known MVP gap.
- **Orphaned files.** A proof uploaded when the save then fails stays in the bucket. A bucket lifecycle rule or a manual sweep clears them; no worker is built for this.

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
| EnrolmentCancelled   | Status → cancelled — by the app (one per enrolment, including each one a class cancel frees, reason `class_cancelled`, v1.10), or by `expire_reservations()` with reason `reservation_expired` (written by the database) | enrolmentId, reason | Notifies Ops, except for `class_cancelled` (ClassCancelled covers it), `reservation_expired` and `checkout_expired` (the Stripe webhook's cancel of an unpaid reservation, v1.25, O55). Never messages the student. Seats are counted, so there is nothing to release. **Built (v1.14):** one Ops task per cancellation; nothing is sent |
| EnrolmentTransferred | Moved between classes                | enrolmentId, fromClassId, toClassId       | Sends transfer confirmation              |
| PaymentRecorded      | Manual payment saved                 | paymentId, enrolmentId, method, amountMyr | Reconciliation, receipt                  |
| ClassChanged         | Date/time/venue edited on a class with confirmed/onboarded/attended enrolments — both "Save and prepare notice" and "Save quietly" (v1.10) | classId, changedFields, noticeId — `null` when Ops saved quietly | Clears the schedule cache. `noticeId` null = recorded, tell nobody. Students are told only through ClassNoticeApproved. **Built (v1.14):** registered, checks the payload, does nothing else. The API feed (§8.1, v1.15) is read live and cached for 5 minutes with a header, which the app cannot purge; the §10.1 page's own cache is refreshed with `revalidateTag("public-schedule")` once the page exists (O38, v1.23) |
| ClassNoticeApproved  | Ops approves change notice           | noticeId, classId                         | Sends to all confirmed students          |
| ClassCancelled       | Class cancelled                      | classId, reason, enrolmentIds             | Notifies the students in `enrolmentIds` once, flags refunds, expires any open Stripe Checkout link of a cancelled reservation (v1.10). **Built (v1.14):** per enrolment one "tell the student" Ops task, plus a "refund needed" Ops task where `payment_net` still holds money; the link of an unpaid reservation goes to `expireCheckoutSession()`, a no-op until O36 |
| ClassPublished       | is_public or status changes — **written by the database (migration 006), not the app** | classId, fromStatus, toStatus, fromPublic, toPublic | Purges schedule cache |
| EnquiryConverted     | Enquiry → deal                       | enquiryId, dealId                         | Attribution                              |
| ConsentChanged       | Consent granted/withdrawn            | personId, purpose, isGranted              | Suppression lists                        |

**How the handlers work (v1.14).** Code: `lib/events/handlers.ts`. There is no email or WhatsApp channel, so everything that needs a person is an Ops task: `type = 'other'`, assigned to the duty super_admin (the same `dutySuperAdmin()` as the duplicate-review task; unassigned only where no active super_admin exists), due now, `person_id` and `enrolment_id` set, no personal data in the title (O37). Each task carries `task.source_key` (migration 011), `<event id>:<what>[:<enrolment id>]`, and is inserted with `ON CONFLICT DO NOTHING`, so a repeat run adds nothing and a task that was already closed is not recreated. A payload that fails its zod check, or an enrolment that does not exist, throws: the row retries with backoff and then becomes a dead letter. A refund is flagged where `payment_net` shows money above zero for the enrolment; the handler never refunds anything. The open Checkout link of an enrolment with nothing paid (`deal.checkout_session_id` through `enrolment.deal_id`; there is no Stripe column on `enrolment`) goes to the port `expireCheckoutSession(sessionId)`.

Event names are exact — a typo is a silent failure. They live in one shared TypeScript union both sides import.

### 11.2 What Shawn writes that Zixuan reads

| Written by          | Table                                    | Zixuan's screens must tolerate                                     |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Stripe webhook      | payment, enrolment, deal                 | Enrolment appearing without user action; person created by webhook |
| WATI webhook        | person, touchpoint, enquiry, message_log | Person with no name (WhatsApp-only) — show phone as display name   |
| n8n (Meta Lead Ads) | person, touchpoint, deal                 | Same as form leads                                                 |
| Workers             | task, enrolment.onboarding_step          | Tasks appearing that nobody created by hand                        |

**Nameless WhatsApp person (S-02, O24).** `person.full_name` stays NOT NULL. When WATI sends a message from a number with no profile name, the intake writes the WhatsApp profile name if there is one, otherwise the phone number as received, and sets `needs_review = true` with `needs_review_reason = 'no_name'`. The UI shows the phone as the display name; correcting the name through the normal edit clears the flag.

**The Stripe webhook never creates a person (v1.25, O56).** The "person created by webhook" row above stays true for WATI only. A Stripe payment that cannot be matched to an existing enrolment is recorded unmatched (§11.3); creating the person and enrolment is Ops' decision in the match screen.

**Implication for UI:** any record may change underneath the user at any moment. Lists refetch on window focus. Detail screens send If-Match with the record's version (§7).

### 11.3 Unmatched payments

When Stripe sends a payment that can't be matched to a person/class, Shawn's worker creates a task of type `match_payment` holding the reduced Stripe details (the allow-list below, not the raw body). Zixuan builds the resolution screen: show Stripe metadata, search for right person/class, confirm → `POST /api/payments/:id/match` (§7.1) creates enrolment, links payment, sets match_status = matched. Safety net for the money path — MVP, not optional.

**Built (v1.25), `lib/integrations/stripe.ts`.** Events are staged in `integration_event` (`source = 'stripe'`, `external_event_id` = the Stripe event id, unique, so a replay is a no-op) and handled from there: inline once, then by `npm run integrations:process` for rows that failed (`FOR UPDATE SKIP LOCKED`, the outbox backoff 30 s / 2 min / 10 min / 1 h, dead after 5 attempts: status `failed` with `attempts` at the cap, which the job no longer claims). Handlers:

- `checkout.session.completed` (and `async_payment_succeeded`) with `payment_status = 'paid'`: matched by `metadata.enrolment_id`; `metadata.class_id` and `metadata.deal_id` must agree with the rows. Matched: a `payment` (`succeeded`; `stripe_card`, or `stripe_fpx` when FPX is the only method; `amount_myr` = `amount_total`/100; `paid_at` = the event time; the payment intent and session ids are unique, so a second event for the same payment adds nothing), then `confirmWhenPaid()` (`lib/payments/confirm.ts`): `confirmed` and `EnrolmentConfirmed` raised when succeeded payments reach the price, else `payment_pending` (§9.12, O16). The status history is written by its trigger. The deal's stage is not touched (O44 is open and the spec says nothing about a paid checkout). `PaymentRecorded` is not raised: §11.1 lists it for manual payments (O58).
- **Unmatched.** The payment is recorded with `match_status = 'unmatched'` and no enrolment or deal link (so it is not counted against a student), plus one open `match_payment` task assigned to the duty super_admin (`source_key` `stripe:<payment id>:match`). The task links the enrolment and person when the metadata named a real enrolment; its notes say why and carry the Stripe ids, the metadata and the customer's email and name. Reasons: no or unreadable metadata, unknown enrolment, `class_id` or `deal_id` disagree, enrolment not `reserved`, `payment_pending`, `confirmed` or `onboarded` (a payment after expiry or cancellation, §12.1), class cancelled or completed, amount not equal to the balance (price minus succeeded payments; a second full payment on a paid enrolment included, O54), or confirming raised `no_seats` (the hold had run out and the class filled). Money is never dropped.
- `checkout.session.expired`: if the enrolment is still `reserved` and the session is the one on its deal (`deal.checkout_session_id`), it is cancelled with `cancelled_reason = 'checkout_expired'` and `EnrolmentCancelled` is raised, like `expire_reservations()`. The `EnrolmentCancelled` handler makes no Ops task for this reason, as for `reservation_expired` (O55). In any other state: no effect.
- Everything else (`charge.refunded`, `payment_intent.*`, ...) is stored with status `ignored` and answered 200 (O53). A charge in a currency other than MYR is not guessed at: the row fails and dead-letters (O54).

**What is stored (v1.25, O35).** `integration_event.payload` is not the raw body. It holds an allow-list: event `id`, `type`, `created`, and for `checkout.session.*` the session `id`, `payment_intent`, `payment_status`, `amount_total`, `currency`, `client_reference_id`, `expires_at`, `payment_method_types`, `metadata`, and `customer_details.email` and `.name`. No address, phone, card data or line items; Stripe keeps the original. The email and name stay as an erasure gap until the O35 retention job blanks the payload; Ops need them to match an unmatched payment by hand.

### 11.4 Integration health

GET /api/health/integrations returns per integration: name, lastSuccessAt, lastErrorAt, lastErrorMessage, queueDepth, status (ok/degraded/down). For Stripe (v1.25), `queueDepth` = `integration_event` rows with `source = 'stripe'`, status `received` or `failed` and `attempts` below 5; rows with `attempts` at 5 are dead letters (the Retry button sets `attempts` back to 0 and `next_attempt_at` to now); `lastErrorMessage` is `integration_event.error` (an error code, never request data). The endpoint is not built yet. Zixuan renders in Settings: table with coloured status dots + Retry button per failed item (posts to Shawn's endpoint).

## 12. Business Rules

Each rule lives in exactly one function in `/lib`, called by API and workers. Duplicating a rule in a React component causes app/automation disagreement.

### 12.1 Seats (rewritten 5 Oct, v1.8 — migration 006)

The database keeps seats and class status. The app never computes either.

```
seatsTaken = enrolments where status in
             (reserved with seat_reserved_until > now(), payment_pending,
              confirmed, onboarded, attended, completed)
seatsAvailable = capacity - seatsTaken
```

One definition: `class_seats_taken(class)`. Waitlisted, cancelled, refunded, no_show and transferred-away rows never hold a seat.

| Condition                             | class_status |
| ------------------------------------- | ------------ |
| seatsAvailable <= 0                   | full         |
| seatsAvailable <= few_seats_threshold | few_seats    |
| otherwise                             | open         |

- **Who recomputes.** Database triggers, on every enrolment insert, delete, status change or class move (both classes), and on capacity or threshold edits. This covers every writer: the app, the Stripe webhook, imports and SQL.
- **Which classes.** Only `open`, `few_seats` and `full`. "Published" means any status except `draft`. `draft`, `cancelled` and `completed` are set by people and never changed by the database. `is_public` is separate: it decides whether the website lists the class, not whether it takes enrolments.
- **Overselling.** Any write that claims a seat on a full class fails with `no_seats` (SQLSTATE P0001) → API 409 `no_seats`. Moving between seat-holding statuses (confirmed → onboarded) never fails. Cancelled and completed classes are exempt, so history can be imported. The service keeps its locked seat check for a friendly message; the database is the authority.
- **Two controls, not one publish button (decided 6 Oct, v1.9).**
  - **Open for booking** sets `status` draft → `open`; the database corrects it to `few_seats` or `full` in the same update. **Back to draft** sets `status` = `draft` and `is_public` = false; refused with 422 `class_has_seats` if any seat is taken (`class_seats_taken` > 0).
  - **Show on website / Hide from website** sets `is_public` only, and is offered only when status is `open`, `few_seats` or `full`. Hiding removes the class from the feed and stops public registration (§8.3 needs `is_public`); staff can still enrol people. Use it for corporate classes and to stop web sign-ups.
  - No action writes both fields except Back to draft. `ClassPublished` comes from the database for either change.
- **Reservations.** Every `reserved` row has `seat_reserved_until` — enforced by CHECK since migration 007. Public register route (Stripe): now + `stripe_reservation_hours` (24, decided 5 Oct), and the same time goes to Stripe as the Checkout `expires_at` — Stripe allows 30 minutes to 24 hours. Reservations staff make: now + `reservation_expiry_hours` (48, O3); the database fills this in if the app leaves it empty.
- **Imports (v1.9).** Don't import `reserved` rows from SalesProcess — map them to `cancelled`. Otherwise the trigger gives each a fresh 48-hour hold and they take seats.
- **Expiry is a write.** `expire_reservations()` runs every 15 minutes from a scheduled job on DigitalOcean (Shawn, decided 14 Oct, O48; the database is on DigitalOcean, so `pg_cron` and Supabase Cron are not used) and moves expired reservations to `cancelled` with `cancelled_reason = 'reservation_expired'`, raising `EnrolmentCancelled`. Shawn's Stripe webhook also cancels the reservation on `checkout.session.expired`, with `cancelled_reason = 'checkout_expired'` (v1.25). Between sweeps the seat count already ignores expired rows; only the badge can lag, by up to 15 minutes. Expiry does not update `last_activity_at` — it is not contact.
- **Payment after expiry.** A Stripe payment that arrives for an already-cancelled reservation is handled as unmatched (§11.3); Operations decides. (Built v1.25. A payment for a reservation whose hold ran out but which no sweep has cancelled yet confirms normally if a seat is free, and goes unmatched if confirming raises `no_seats`.)
- **Events.** `ClassPublished` is written by the database whenever `status` or `is_public` changes. The app does not raise it.
- **Concurrency.** Seat check + enrolment insert stay in one transaction that locks the class row; the triggers take the same lock. Two bookings for the last seat: one succeeds, the other gets `no_seats` (tested 5 Oct).

### 12.2 Duplicate prevention

On every person create, any route:

1. Normalise email and phone.
2. **Hard match** — same email_norm or phone_e164 → use existing person, don't create. API create → 409 with existing record; public form silently attaches.
3. **Soft match** (revised 24 Sep) — create the person but set `needs_review = true` when the **normalised name** matches and either: (a) the company matches — `normalise_company_name(typed companyName)` equals the candidate's current company `name_norm` or `normalise_company_name(candidate.company_name_given)`; a NULL never matches (reason `possible_duplicate_company`), (b) the email local part matches at a different domain (`tan.ml@gmail.com` vs `tan.ml@acme.com`), or (c) the last 7 phone digits match.
4. **Normalised name** = lowercase, spaces/hyphens/dots/apostrophes removed. "Tan Mei Ling", "Tan Meiling" and "TAN MEI-LING" compare equal without a fuzzy-matching library.
5. **Never merge automatically, never flag on name alone.** Malaysian/Chinese names collide constantly — flagging every "Tan Wei Ming" would bury the review queue.

**Working a flagged person (v1.18, drafted from commit 1758c22 for Shawn's proofreading).**

- **The pair stays in the task.** A soft match keeps the candidate: it raises the §7.1 `review_duplicate` task in the same transaction as the person (`person_id` the new person, `related_person_id` the candidate, assigned to the duty super_admin, due today). The pair is not a column on `person`; no schema change. 9.2 names the other record, links to it, and offers Compare and merge (9.3, super_admin) with the candidate's id.
- **"Not a duplicate".** `POST /api/people/:id/review/dismiss` (§7) clears `needs_review` and `needs_review_reason` together (the CHECK in §5 requires it), closes the pair's open `review_duplicate` task (`done_at`, `done_by` the reviewer) and writes one `audit_log` row (the old reason, the candidate's id, `notADuplicate`, the optional note). It is a separate route, not part of PATCH, so §9.16 can tell "these are different people" from an edit. It sends `If-Match` like every other person write (§7): a stale version is a 409. It is refused with 422 `not_flagged` for a person who is no longer flagged (another reviewer got there first, or a merge took the record out of the queue), so two reviewers cannot both read success. A merge (§12.10) is the other way out: it closes the pair's task.
- **`phone_unnormalised` clears differently.** It names a defect in one record, not a pair, so it raises no task and has no dismiss. Saving a phone that normalises clears the flag through the normal person edit. `no_name` (§11.2) clears the same way, on the name: when a person edit (PATCH /api/people/:id) sends a non-blank `fullName` that differs from the stored one and the stored reason is `no_name`, `needs_review` and `needs_review_reason` are cleared together. Any human edit of the name is the signal, because a WhatsApp profile name is also a `no_name` case. The dismiss route is refused for these two reasons (422 `not_a_pair`) and 9.2 does not show "Not a duplicate" for them, so `notADuplicate` in the audit log always means someone proposed a pair (O50, decided 16 Oct, v1.21; built by Zixuan).
- **Who may review.** super_admin, sales and support (person write, not the assigned-only kind, §6); operations reads people and cannot; part_time and marketing cannot.
- **Records flagged before pairs existed.** A person flagged before v1.18, and one flagged by `possible_duplicate_*` with the candidate since merged away, deleted or erased, has no open pair task: there is no candidate to name or to open 9.3 with, but "Not a duplicate" still works (the route needs only the flag). No backfill: the candidate cannot be recovered from the reason code.

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
reserved --> confirmed
reserved --> waitlisted
reserved --> cancelled
waitlisted --> reserved
payment_pending --> confirmed
payment_pending --> cancelled
confirmed --> onboarded
confirmed --> transferred
confirmed --> cancelled
onboarded --> attended
onboarded --> cancelled
onboarded --> no_show
attended --> completed
cancelled --> refunded
```

Any transition not on this diagram → 422. UI only offers legal next statuses — no free dropdown of all eleven states.

**v1.8:** `reserved → confirmed` is a successful online (Stripe) payment. `payment_pending` now means only "waiting for an offline payment" — HRDC approval or bank-transfer proof — and does not expire by itself. `reserved → cancelled` is also how an expired reservation ends (§12.1).

**v1.25:** the Stripe webhook moves `reserved` or `payment_pending` to `confirmed` through `confirmWhenPaid()` (§11.3), and `reserved` to `payment_pending` when payments so far are below the price. `reserved → cancelled` also happens on `checkout.session.expired`, reason `checkout_expired`.

**v1.10:** `onboarded → cancelled` added — a class can be cancelled after its onboarding messages went out, and a student can withdraw after onboarding. `attended`, `completed` and `no_show` are history and never move to `cancelled`.

### 12.5 Deal stages

- Stage must belong to deal's pipeline. Corporate stage on individual deal → 422.
- Moving to `lost` requires `lostReasonId` referencing an **active** `lost_reason` row — a deactivated reason can't be picked for a new loss.
- Corporate deals can't pass `discovery` without company, headcount, funding type.
- Every change writes deal_stage_history + raises DealStageChanged.
- won_at/lost_at set by service, never by a form.
- **Leaving Won or Lost (v1.6).** Moving a deal out of `won` clears `won_at`; out of `lost` clears `lost_at` and `lost_reason_id`. Entering `won`/`lost` again sets them fresh. The previous stages stay in `deal_stage_history`.
- **Won with money (v1.6).** A deal can't leave `won` while any payment linked to it (directly or through its enrolments) is not fully refunded → 409 `deal_has_payment`, "Refund or cancel the payment first". Otherwise revenue reports and the board disagree.
- **Correcting a lost reason (v1.7).** On a deal already in `lost`, PATCH /api/deals/:id may change `lost_reason_id` on its own: it must be an **active** reason and cannot be cleared. The stage does not change, so no `deal_stage_history` row is written and no `DealStageChanged` is raised; the change is in `audit_log`. Reports must read `lost_reason_id` from the deal, never from stage history.
- **Days in stage (v1.6).** `stage_changed_at` resets on every real stage move, as before — a deal that goes back and forth starts from 0 each time. Every move is kept in `deal_stage_history`, so the dashboards can flag deals that keep bouncing.

### 12.6 HRDC

MVP scope: fields and reminders only — no document generation, no portal automation (no HRD Corp API).

- funding_type = hrdc makes hrdc_grant_ref, hrdc_approval_date, hrdc_deadline_date visible+required before deal reaches `won`.
- HRDC enrolment stays payment_pending, not confirmed, until manual payment/approval recorded — must not count as paid revenue.
- **HRDC deadline task (revised v1.6).** Created by the app, in the same transaction as the save, when a deal with `funding_type = hrdc` enters `funding` with an `hrdc_deadline_date`, **or** gets a deadline date while already in `funding`. Due on `hrdc_deadline_date`, assigned to the deal owner. If the deadline date changes, update the open task's `due_at`. At most one open `hrdc_deadline` task per deal — enforced by the database (migration 004); on a unique violation, update the open task instead of inserting. **No worker creates this task** — Shawn's `DealStageChanged` handler only does SLA tracking and notifications (§11.1). Whether the reminder should fall due some days before the deadline depends on O7.
- **Withdrawn HRDC task (v1.7).** When the deadline date is cleared, or `funding_type` is changed away from `hrdc`, the app closes the open `hrdc_deadline` task by setting `done_at` and `done_by` (the user making the change) in the same transaction. It is not deleted, and there is no `cancelled` state, so reports cannot tell a withdrawn reminder from a completed one. If that distinction matters, add a `cancelled` state before the 16 Oct schema freeze. Closing it frees the one-open-task slot, so a new deadline creates a fresh task.
- Grant lead time and claim window are configurable settings, not constants (guidance conflicts and changes).

### 12.7 Money

- All amounts numeric(12,2), MYR.
- price_paid_myr on enrolment is a snapshot at purchase, never follows later price changes.
- Refunds reduce refunded_amount_myr; original payment row never edited/deleted.
- Revenue = succeeded payments minus refunds — not deal values, not enrolment counts.
- A wrong amount has no correction route in the app (v1.11): the app never edits a payment, and Operations cannot refund. Until a later super_admin route exists, a `super_admin` corrects it in SQL and writes an audit note saying why. Proof files stay in the bucket with the payment row (O12); erasure never touches them.

### 12.8 Class changes

Editing start_date, start_time, end_date, end_time, venue_name, venue_address, or online_url on a class with confirmed, onboarded or attended enrolments raises ClassChanged. "Save and prepare notice" also creates a pending notice (its id is in the event); "Save quietly" creates none and the event carries `noticeId: null` (v1.10). Nothing reaches a student until Operations approves a notice. Editing capacity, price, or internal notes needs no notice. Reminders and onboarding messages read the class date, time and venue when they are sent, never a copy saved earlier, so a quiet change is still right in the next reminder.

**Cancelling a class (v1.10).**
- Refused with 422 `class_started` once `start_date <= today` or any enrolment is `attended` or `completed`. A class that needs a new date gets a date change, not a cancel.
- In one transaction: class → `cancelled`; every `reserved` (hold not yet expired), `payment_pending`, `confirmed` and `onboarded` enrolment → `cancelled` with `cancelled_reason = 'class_cancelled'`, one EnrolmentCancelled each; pending notices discarded; one ClassCancelled listing those enrolments. `attended`, `completed`, `no_show`, `transferred`, `refunded` and already-cancelled rows are not touched. Expired reservations are left for the sweep.
- Shawn's worker, on ClassCancelled: tells each student once, flags refunds, and expires the open Stripe Checkout link of each cancelled reservation so nobody can pay for a cancelled class. A payment that still arrives is handled as unmatched (§11.3).

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

**Erasure checklist (v1.12, O11).** `erase_person()` only covers our database. The person's data also exists elsewhere, so an erasure request is not finished until a super_admin has worked through this list and written the result in the erasure reason or a linked note:

| Where | What to do |
| --- | --- |
| Stripe | Ask Stripe to delete or redact the customer record where allowed; card and payment records Stripe must keep stay there |
| WATI | Delete the contact and conversation in WATI |
| Email provider | Remove the address from lists and suppress it; delete stored messages where practical |
| Payment proof bucket | Proof files stay with the payment row (O12) and can show a name and account number. The privacy review decides whether to keep or redact them; until then they stay |
| `audit_log` | Earlier rows still hold the person's old values (O13). Not redacted at go-live |

Do not tell the person their data is "fully erased" until the privacy review has confirmed the wording for what is kept and why.

**Soft delete** — `soft_delete_person(person, actor, reason)`
For junk and test records only. Refused for anyone with an enrolment or payment; use erasure instead. The audit row stores the reason, not a copy of the record.

### 12.11 Who writes what (added 5 Oct, v1.8)

**Rule placement.** A rule that must hold whoever writes the row — the app, a webhook, n8n, an import or SQL — lives in the database. A rule about one screen's behaviour lives in `/lib`. Every value that changes by itself over time has a named writer and schedule. A new derived or time-based value goes into this table before it is built.

| Value | Source of truth | Written by | When | May lag |
| --- | --- | --- | --- | --- |
| `class.status` (open/few_seats/full) | `class_seats_taken()` | Database triggers (006) | Enrolment or capacity change | Up to 15 min after a reservation expires |
| Seat check | `class_seats_taken()` | Database trigger (006); service checks too, for the message | Every write that claims a seat | Never |
| Reservation expiry | `seat_reserved_until` | `expire_reservations()` from a scheduled job on DigitalOcean (Shawn, decided 14 Oct, O48); Stripe webhook on `checkout.session.expired` | Every 15 min / on the Stripe event | 15 min |
| `ClassPublished` event | `class.status`, `is_public` | Database trigger (006) | On change | Never |
| `version` | — | Database trigger (005) | Every update | Never |
| `enrolment_status_history` | `enrolment.status` | Database trigger (009), on insert and on every status change; no application code writes it | Every status change | Never |
| `class.cancelled_at` / `cancelled_reason` | — | `cancelled_at`: database trigger (009). `cancelled_reason`: `cancelClass()` | Class → cancelled | Never |
| Outbox retry (`next_attempt_at`, `dead_at`) | `event_outbox` | `drainOutbox()` (010) | Each failed attempt | Until the next drain run |
| HRDC deadline task | Deal fields | App, same transaction (§12.6, guard 004) | Stage or deadline change | Never |
| `last_activity_at` | §12.9 list | `touchPersonActivity()` in `/lib`; workers call the same helper | Each listed event | Never |
| Lifecycle stage | Payments, enrolments | Computed on read (§12.3) | On read | Never |
| `won_at`, `lost_at`, `stage_changed_at` | Stage moves | Deal service in `/lib`; the Stripe worker calls the same function | Stage move | Never |
| `enrolment.onboarding_step` | — | Shawn's workers | Each onboarding send | — |
| Class → `completed` | — | Operations, by hand | After the class ends | Until someone does it |
| Waitlist promotion | — | Operations, by hand (O5: waitlist deferred) | When a seat frees | — |
| `seat_reserved_until` | Setting for the route | App sets it (register route); database fills it if empty (006); CHECK (007) | Every `reserved` write | Never |
| `is_public` | — | Operations: Show/Hide on website; Back to draft clears it (§12.1) | By hand | — |
| Stripe Checkout link of a reservation | Stripe | Expires by itself at the hold time; Shawn's worker expires it early on ClassCancelled (§12.8) | Class cancel | Never until O36 is built; until then the link lives to its hold time |
| Ops tasks from events (`source_key` set) | `event_outbox` | `drainOutbox()` handlers (§11.1) | Next drain run after the event | Until the next drain run |
| Public form: person, touchpoint, consent, deal, `LeadCaptured` | Form body | `captureLead()` in `lib/public/leads.ts`, one transaction (§8.2) | Each accepted submission | Never |
| IP rate-limit counters (`rate_limit_hit`; the bucket is a hash keyed with `RATE_LIMIT_SECRET`) | Request headers | `rate_limit_take()` (012), swept by the next call | Each request that passes the key | Rows live up to an hour |
| Date/venue shown in reminders | `class` row | Shawn's workers, read at send time (§12.8) | Each send | Never |

**Register notes (v1.14).** (1) Enrolments are never deleted: `enrolment_status_history` references them and is append-only, so an import or admin tool that needs an enrolment gone must cancel it. (2) `enrolment_status_history.changed_by` is always NULL: the database does not know the actor, and the `audit_log` row of the status move has it. (3) `class.cancelled_reason` is written by `cancelClass()` but not enforced by a CHECK, so a class cancelled by direct SQL has none. (4) `lib/classes/service.ts`, `lib/enrolments/service.ts` and `lib/classes/notices.ts` insert into `event_outbox` by hand in eight places; this is equivalent to `raiseEvent` and stays.

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
- Rate limits: 5 failed sign-ins/account/15min; public endpoints per §8 (built v1.15: 10/IP/min in the database, 3/phone/hour from touchpoints; O40).
- Uploads: images + PDF only, 10MB max, content-type verified server-side (not by extension), private bucket, short-lived signed URLs.
- Zod validation on every endpoint; never trust a client-sent id — always check caller may touch that record.
- Parameterised queries only. No string-built SQL anywhere.
- Dependencies scanned; no known-critical vulnerabilities at go-live.
- Secrets rotate-able without a code change.
- **Database exposure (O47, reworded 14 Oct).** The database is a PostgreSQL database on DigitalOcean, not Supabase, so there is no Data API (PostgREST) to turn off. Before go-live: the database is not reachable from the public internet except from the app and job hosts (trusted sources or firewall setting); connections require TLS; and no table or function is exposed through any REST layer (if Supabase stays for sign-in and proof files, O49, its Data API must not point at the app database). Date: Fri 27 Nov.
- **Client IP behind the new host (O40, decided 13 Oct).** The rate limiter reads `x-real-ip`, then `x-forwarded-for`. Before go-live, verify behind DigitalOcean's proxy or load balancer that it overwrites both headers, so a caller cannot choose their own bucket. Not yet checked.

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

**Go-live gate (v1.24): no live payment before the `checkout.session.completed` webhook exists (§8.3, §11.3)**, or a paid enrolment expires and frees its seat.

**Before go-live, all must pass:** full backup restore, concurrency test, Stripe test payment end-to-end from landing page, WATI message creating an enquiry, schedule feed serving live website. Also, from v1.18: the database accepts connections only from the app and job hosts, over TLS, and no table is exposed through any REST layer (O47, reworded 14 Oct, Fri 27 Nov); the client-IP header trust is verified behind DigitalOcean's proxy (O40); and a scheduled job on DigitalOcean runs `expire_reservations()` every 15 minutes (O48, decided 14 Oct).

### 15.3 Open items

| #   | Question                                                                                  | Blocks                 | Needed by    | Owner                  |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- | ------------ | ---------------------- |
| O1  | Google Workspace or Microsoft 365? Decides SSO                                            | §6 auth                | Sprint 1     | Shawn                  |
| O2  | Store WhatsApp message bodies, or metadata only? (PDPA)                                   | message_log.body       | Sprint 2     | Shawn + privacy review |
| O3  | _Decided 13 Oct (v1.18)._ Reservation expiry: 48 hours for reservations staff make; the Stripe path stays 24 hours.                                          | Seat logic             | Sprint 2     | Operations (decided by Shawn)             |
| O4  | First-response SLA in business hours                                                      | Enquiry screen, alerts | Sprint 3     | Wei Ping               |
| O5  | Waitlist in MVP or January?                                                               | Class detail scope     | Sprint 3     | Client (pending)       |
| O6  | Refund and transfer policy in writing                                                     | Enrolment actions      | Sprint 4     | Finance                |
| O7  | HRDC grant lead time and claim window values                                              | HRDC reminders         | Sprint 4     | Finance                |
| O8  | Who owns website deploy, does Zixuan have access?                                         | §10, all of it         | **Sprint 1** | Management             |
| O9  | _Decided 13 Oct (v1.18)._ Corporate booking: one HR contact registering 10 staff — the Booker model is built as specified in §12.2 | Enrolment screens      | Sprint 3     | Operations (decided by Shawn)             |
| O10 | Certificate numbering format                                                              | Enrolment              | January      | Operations             |
| O11 | Does anonymisation (§12.10) satisfy a PDPA erasure request? | Erase route | Sprint 2 | Shawn + privacy review |
| O12 | How long must payment and invoice records be kept? | Retention, erasure scope | Sprint 4 | Finance / accountant |
| O13 | `audit_log` rows written before an erasure still hold that person's old values (append-only). Accept, or allow a controlled redaction? | Erasure completeness | Sprint 2 | Shawn + privacy review |
| O14 | `touchpoint.landing_url` / `referrer` can carry personal data in the query string (e.g. `?email=`). Strip at capture? _Decided 13 Oct (v1.18): yes, for every capture path._ | Touchpoint capture, erasure | Sprint 2 | Shawn |
| O15 | Which fields can the 9.3 merge screen choose between (the `fields` map)? | Merge route validation | Sprint 1 | Zixuan + Shawn |
| O16 | Part payments and HRDC timing: is an enrolment confirmed only when payments reach the price? Is an HRDC payment recorded only when the money arrives? | 9.12, payment rule in the database | Sprint 2 | Finance |
| O17 | _Closed 9 Oct._ Checkout Sessions expire within 24 h; reservation default is 48 h. Decided 5 Oct: the Stripe path holds 24 h (`stripe_reservation_hours`, migration 006, §8.3). | — | — | — |
| O18 | Discounts through the link (deal amount ≠ class price). Proposed: not in MVP. | Checkout link | TBD by Shawn | Shawn |
| O19 | `aggregate_type` for events other than `DealStageChanged`. Built as: `LeadCaptured`, `ConsentChanged` → `person`; `Enrolment*` → `enrolment`; `PaymentRecorded` → `payment`; `Class*`, `ClassNoticeApproved` → `class`; `EnquiryConverted` → `enquiry` (one map in `lib/events/types.ts`). Confirm. | Event contract | TBD by Shawn | Shawn |
| O20 | _Closed 9 Oct._ `reserveSeat` rules (public flag, "started" date, status recompute). Superseded: seat checks and class status are database triggers (migration 006, §12.1); the TypeScript `reserveSeat` was dropped. | — | — | — |
| O21 | Retry cap and backoff for a failing event: 5 attempts, waiting 30 s, 2 min, 10 min, 1 h between them, then `dead_at` is set and the row waits for `retryDeadEvents()` (migration 010). Confirm the schedule, and decide who reviews dead rows. | Outbox drain | TBD by Shawn | Shawn |
| O22 | _Closed 9 Oct._ Re-booking after an expired reservation. Superseded: `expire_reservations()` cancels expired reservations every 15 minutes (migration 006) and migration 007 backfills holds. | — | — | — |
| O23 | A `match_payment` task cannot point at its payment, so the match route cannot find the task it must close. | Stripe worker, 9.12 match screen | Tue 13 Oct | Shawn |
| O24 | A WhatsApp-only person with no name cannot be stored: `full_name` is NOT NULL and the spec does not say what to write. | WATI intake, every screen that shows a name | Tue 13 Oct | Shawn + Zixuan |
| O25 | Payment rows can contradict themselves (status vs refunded amount, missing `paid_at`), refunds have no date, and three code paths define "paid" differently. | Stripe worker, manual payment, lifecycle, BI | Tue 13 Oct | Shawn |
| O26 | Enrolment status has no history or transition times; the person timeline shows only the current status. | Enrolment routes, expiry sweep, BI | Tue 13 Oct | Shawn + Zixuan |
| O27 | The spec uses columns §5 never defines: class internal notes, class cancel reason and date, HRDC document key. | Zixuan 9.6, 9.8 to 9.10 | Tue 13 Oct | Shawn + Zixuan |
| O28 | A `reserved` enrolment with no `seat_reserved_until` holds its seat forever and no sweep can find it. | POST /api/enrolments, `expire_reservations()` | Tue 13 Oct | Shawn + Zixuan |
| O29 | Touchpoints are append-only with no external reference, so a repeated import or retried webhook cannot be deduplicated or undone. | Data import, Lead Ads, WATI | Tue 13 Oct | Shawn |
| O30 | A deal does not record the touchpoint that created it, so campaign-to-revenue reports have to guess. | Public intake, reporting views | Tue 13 Oct | Shawn |
| O31 | The public-form `idempotencyKey` has no place to live; `integration_event` cannot hold it cleanly. | /api/public/leads, /register | Tue 13 Oct | Shawn |
| O32 | A withdrawn HRDC task looks the same as a completed one, and the timeline shows "Task done". | hrdc-task.ts, timeline, reports | Tue 13 Oct | Shawn |
| O33 | `done_at` requires `done_by`, so a worker (system actor, no user) can never close a task. | Stripe worker, expiry sweep | Tue 13 Oct | Shawn |
| O34 | `event_outbox` has no backoff, no dead-letter marker and no stable order; a failing row burns all 5 attempts in milliseconds. | drain.ts, health panel | Tue 13 Oct | Shawn |
| O35 | Erasure leaves personal data behind inside our database: `integration_event.payload` (decided v1.25 for Stripe: the raw body is never stored, only the allow-list in §11.3, which still holds the customer's email and name until a retention job blanks it; the WATI webhook, when built, must do the same, because O2 says message text is not stored), `task.title`, unmatched-payment task notes, `enrolment_status_history.reason` (copies the free-text `cancelled_reason`; `erase_person` does not clear it), URLs (O14). The `audit_log` part is decided (O13, v1.12: rows stay for go-live, super_admin only) and sits on the §12.10 erasure checklist with the outside systems. | erase_person, retention, privacy review | Tue 13 Oct | Shawn |
| O36 | Expiring an open Stripe Checkout link on ClassCancelled needs a Stripe call; the handler calls a port `expireCheckoutSession(sessionId)` that is a no-op today. Shawn will supply the Stripe test keys (13 Oct; no date yet). **Built v1.25** (`lib/integrations/stripe-api.ts`): the real call, a no-op while `STRIPE_SECRET_KEY` is unset; tested with a fake fetch only, never against Stripe. | Stripe worker | Stripe test keys | Shawn |
| O37 | _Decided 13 Oct (v1.18): they stay with the duty super_admin, type `other`; revisit after go-live. No schema change._ Tasks the handlers create are type `other` and, since v1.17, assigned to the duty super_admin (Home lists only tasks assigned to the viewer, so unassigned ones were invisible). The question was: should they go to Operations instead of one super_admin, and do refund and "tell the student" need their own task types (a schema change)? | Tasks screen, Home | Fri 16 Oct | Shawn + Zixuan + Operations |
| O38 | `ClassChanged` is meant to clear a schedule cache. The API feed (§8.1, v1.15) caches only through the `Cache-Control` header (5 minutes at the edge), which a class edit cannot purge from inside the app. The §10.1 schedule page (v1.23) keeps its own 5-minute cache tagged `public-schedule`, so once it is built a class edit refreshes the page with `revalidateTag("public-schedule")`, called from the class edit and cancel code, and the `ClassChanged` handler can call the same function. The feed's edge copy stays up to 5 minutes stale; if that matters to the marketing site, Netlify's cache purge call (not looked up) is the only way. Not yet checked: whether Netlify keeps Next's cache across serverless instances. | GET /api/public/schedule, §10.1 | Before go-live | Shawn + Zixuan |
| O39 | Which CAPTCHA provider? The spec says "CAPTCHA" (§8.2, §10.3) and never names one. | POST /api/public/leads, website forms | Fri 30 Oct | Shawn + Zixuan |
| O40 | _Decided 13 Oct (v1.18)._ Rate limiting at the app (migration 012) or at the edge? The app counter works anywhere and stays; an edge limiter (Cloudflare, a load balancer) is cheaper per request and stops floods before they reach the database, and is optional, later. The client IP is read from `x-real-ip` / `x-forwarded-for`, which is only right behind a proxy that overwrites them: with the workers moving to DigitalOcean, this must be verified behind its proxy or load balancer before go-live (§14, §15.2). It is not yet known to be safe. | POST /api/public/leads | Before go-live | Shawn |
| O41 | What a public form does not save. `message` has no column and goes into `person.notes` (which `erase_person` clears, §12.10, and which is not the WATI message text that O2 says we do not store); a new email or phone from a person we already know is not added to them; `jobTitle` and `preferredLanguage` are used only when the person is new. A `message` column, or a row for the visitor's question, is a schema change. _Decided 13 Oct (v1.18): `message` stays in `person.notes`; no new column._ | Sales follow-up, §5 | Fri 16 Oct (schema freeze) | Shawn + Zixuan |
| O42 | Public API settings and the cached schedule. Someone has to set `PUBLIC_API_KEY`, `PUBLIC_ALLOWED_ORIGINS`, `PUBLIC_WEBSITE_URL`, `TURNSTILE_SECRET_KEY` and `RATE_LIMIT_SECRET` on the host and give the website its key. A schedule response cached at the edge may be served without the key; the data is public by design. | Website (§10), O8 | Mon 2 Nov | Shawn + Zixuan |
| O43 | `POST /api/public/register` (§8.3) is not built. Since v1.24 (26 Oct) Zixuan builds it, with `createCheckoutSession()` and a test key from her own Stripe account; Shawn's test keys (13 Oct, no date yet) are needed for the webhook and the end-to-end go-live test, not for her work. | §8.3, §10.4 | Stripe test keys | Shawn |
| O44 | Does creating a checkout link move the deal to `checkout_sent`? Spec is silent. | Checkout link | TBD by Shawn | Shawn |
| O45 | A website visitor ticks the marketing box but already withdrew that purpose (latest `consent` row is a withdrawal). The form no longer re-grants it: nothing is recorded, the lead is captured. _Decided 13 Oct (v1.18): the public form never re-grants a withdrawn consent; opt-in again only through Ops, or a future double opt-in feature (not built)._ The question was whether a withdrawn person should be able to opt back in through the form at all, and if so by double opt-in (a confirmation link or WhatsApp message) rather than a tick. Per purpose, so a person who withdrew email but never had WhatsApp still gets a WhatsApp grant from the ticked box. | POST /api/public/leads, §10.3, §14 | Mon 2 Nov | Shawn + privacy review |
| O46 | The `idempotencyKey` is not tied to the visitor: a key reused by someone else, or with another body, returns the first call's `personId` and `dealId` (ids only, no personal data). Keys are client-generated (a UUID), 8 to 100 characters. _Accepted 13 Oct (v1.18): the key stays unattached to the submitter._ The question was whether to tie the key to the submitter (normalised email or phone of the stored person; 409 on a mismatch) or accept. A check has awkward cases: a person matched by phone while the email differs, a merged or erased person, an unnormalisable phone. | POST /api/public/leads | Mon 2 Nov | Shawn |
| O47 | No Supabase RLS and no REVOKE from `anon`/`authenticated` on the tables (001's posture; migration 009's `enrolment_status_history` follows it; only the functions and `rate_limit_hit` are revoked). That mattered while the database was assumed to be Supabase, where the Data API (PostgREST) could expose the `public` schema to the anon key. _Reworded 14 Oct (v1.19): the database is on DigitalOcean (O48), so that concern no longer applies. What must still be true before go-live: the database is not reachable from the public internet except from the app and job hosts (trusted sources or firewall setting); TLS is required for connections; no table is exposed through any REST layer (checked again if a Supabase project stays for sign-in and files, O49). Checklist lines in §14 and §15.2._ | All tables, §14 | Fri 27 Nov (go-live 14 Dec) | Shawn |
| O48 | _Decided 14 Oct (v1.19)._ Where does the database live, and what runs `expire_reservations()` every 15 minutes? The workers and the outbox drain moved to DigitalOcean (13 Oct). Shawn decided on 14 Oct: the database is a PostgreSQL database on DigitalOcean, and a scheduled job on DigitalOcean calls `expire_reservations()` every 15 minutes (the fallback adopted). `pg_cron` and Supabase Cron are not used. Migration 006's own comments still name Supabase Cron; migrations are not edited. | §12.1, §12.11, §2, O47, O49 | Fri 16 Oct | Shawn |
| O49 | _Decided 16 Oct (v1.20): fallback accepted, see the calendar._ Login and file storage after the database moves to DigitalOcean. Facts from the code (14 Oct): (1) sign-in is Supabase Auth: `@supabase/ssr` and `@supabase/supabase-js`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `proxy.ts` refreshes the session, `lib/auth/server.ts` and `lib/auth/sign-in.ts` call it. (2) The app database links to it only through `app_user.auth_user_id`, a plain `text UNIQUE` column with no foreign key to `auth.users` (migration 001), so no migration depends on the Supabase `auth` schema and nothing breaks across two databases; only `scripts/seed-dev.ts` reads `auth.users`. (3) Payment proofs go to a private Supabase Storage bucket (`PAYMENT_PROOF_BUCKET`) through `lib/uploads/signer.ts` with `SUPABASE_SERVICE_ROLE_KEY`; the spec's S3 variables (§2) are unused by the code; the spec said the provider sits behind that one file. (4) Migrations revoke `EXECUTE` from `anon`/`authenticated`; harmless on a database without those roles (the migration guards each role). Options: (a) keep a Supabase project for sign-in and proof-file storage only, with the app tables on DigitalOcean, and document the mapping of each Supabase user id to `app_user.auth_user_id`; (b) replace sign-in and storage (another auth provider; an S3-compatible bucket), which changes `lib/auth/*`, `proxy.ts` and `lib/uploads/signer.ts` but not the schema. Neither option needs a migration, so this is not a schema change. Still open and separate: whether the web app itself moves from Vercel. Shawn named only the database and the jobs; §2 Hosting, O38 and O42 stay as written until he says. | §2, §6, §9.12, §14, O47, O48 | Fri 16 Oct (schema freeze) | Shawn |

| O50 | _Decided 16 Oct (v1.21): see the calendar._ Nothing clears a `no_name` review flag. Editing the person's name leaves `needs_review` set (only `phone_unnormalised` clears itself, in the person edit and in merge), and the only exit is the "Not a duplicate" dismiss route (§12.2), which is the wrong label for it. Should saving a real name clear `no_name` the way a good phone clears `phone_unnormalised`, or should the dismiss button say something neutral? Found while proofreading the v1.18 duplicate-review wording; `no_name` is raised by the WhatsApp intake (§11.2), which is not built, so nothing is flagged this way yet. | §9.2, §11.2, §12.2 | Before the WhatsApp intake is built | Shawn + Zixuan |
| O51 | A person flagged `no_name` who never gives a name stays flagged. The flag is a to-do ("ask who this is"), and the stored name is already the placeholder (the WhatsApp profile name, or the phone number, §11.2), so nothing can clear it honestly without learning the name. O50 clears it when someone types a real name; "Not a duplicate" is refused for it (422 `not_a_pair`). Options for a person who never replies: leave the flag, or let the reviewer record "asked, no name given" as a neutral dismiss with its own audit marker (never `notADuplicate`, which means a proposed pair was rejected). Which is right depends on how many never reply; nothing writes `no_name` until the WhatsApp intake (§11.2) is built. Raised by Zixuan on the S1 pull request. | §9.2, §11.2, §12.2, §7 | Four weeks after the WhatsApp intake goes live | Shawn + Zixuan |
| O52 | A person created by `POST /api/people` or the public form with an unnormalisable phone and a soft match is stored as `phone_unnormalised` (that reason replaces the soft-match reason) and still gets the pair's `review_duplicate` task. Fixing the phone clears the flag but leaves the task open, so a person can have an open pair task and no flag. "Not a duplicate" cannot be the exit: it is refused for `phone_unnormalised` and `no_name` (§12.2, O50), and letting it clear them would clear a defect nobody fixed and, through the either-end task match, could close another person's pair. Found in the review of PR #5. Options: leave the task as the to-do; or the phone fix also keeps the pair visible (swap the reason to a `possible_duplicate_*` one); or the Tasks screen (§9.14) closes a pair task as "not a duplicate". | §7.1, §9.14, §12.2 | Before §9.14 is built | Shawn + Zixuan |
| O53 | Refunds and charges are not handled: `charge.refunded`, `payment_intent.*` and `charge.dispute.*` are stored as `ignored`. A refund made in Stripe does not reach `payment.refunded_amount_myr`, so `payment_net` overstates revenue until someone records it. Fallback: Ops record refunds by hand (§12.7). Option: handle `charge.refunded` in the same module once Finance wants it. | §12.7, §11.3 | Before the first real refund | Shawn + Finance |
| O54 | Amount rule for a paid Checkout session: it matches only if the amount equals the enrolment's balance (price minus succeeded payments; price = `price_paid_myr`, else the class price, else the course list price). Anything else, a second full payment on a paid enrolment included, is recorded unmatched with a task. A charge in a currency other than MYR makes the row fail and dead-letter instead (the payment table is MYR only). Option: let a smaller Stripe amount count as a part payment. | §11.3, §12.7 | Stripe test keys | Shawn + Finance |
| O55 | `checkout_expired` is a new `cancelled_reason`. The `EnrolmentCancelled` handler makes no Ops task for it (like `reservation_expired`) and nothing is sent to the student. Alternative: an Ops task so someone follows up with the lead who did not pay. | §11.1, §12.1 | Go-live | Shawn |
| O56 | The Stripe webhook never creates a person or an enrolment (§11.2 once listed "person created by webhook"; that is WATI only). A payment with no matching enrolment waits as unmatched for Ops. | §11.2, §11.3 | Go-live | Shawn |
| O57 | The retry job `npm run integrations:process` (Stripe events that failed or were never processed) needs a DigitalOcean scheduled job, every 5 minutes suggested, beside `expire_reservations()` (O48) and `npm run events:drain`. Without it a failed inline run waits for ever, because Stripe got its 200. | §11.3, §15.2 | Go-live | Shawn |
| O58 | Two gaps beside the webhook. (a) The part-payment rule lives in `lib/payments/confirm.ts`, not in the database as §9.12 asks, and the manual-payment service (`lib/payments/service.ts`) does not call it: it confirms on any amount. Until O16 is answered and the rule moves into the database, the two flows disagree on part payments. (b) `PaymentRecorded` is raised for manual payments only; the Stripe path raises `EnrolmentConfirmed` but not `PaymentRecorded`, so a future receipt handler would miss card payments. Fallback: leave both; nothing consumes `PaymentRecorded` yet. | §9.12, §11.1 | O16 answer | Shawn + Finance |

**Decision calendar (added 23 Sep).** Every open item now has a date. If an answer misses its date, the fallback in the last column is what gets built — nobody waits.

| # | Decide by | Who decides | Fallback if the date passes |
|---|---|---|---|
| O8 website deploy access | **Fri 25 Sep** | Management | Blocker, not a fallback — escalate the same day; Sprint 3 cannot start without it |
| O1 auth (SSO vs email+MFA) | Fri 2 Oct | Shawn | Email + password with MFA (see below) |
| O2 store message bodies | Fri 9 Oct | Shawn + privacy review | **Decided 9 Oct (v1.12): metadata only; no bodies stored.** Revisit with AI classification (Phase 5) |
| O3 reservation expiry | Fri 16 Oct | Operations | **Decided 13 Oct (v1.18): 48 hours for reservations staff make.** Stripe-path holds stay 24 hours (Stripe's maximum), decided 5 Oct |
| O9 corporate booker model | Fri 16 Oct | Operations | **Decided 13 Oct (v1.18): build as specified in 12.2** |
| O4 first-response SLA | Fri 30 Oct | Wei Ping | 1 business hour, configurable |
| O5 waitlist in MVP | Fri 30 Oct | Client | Defer to January |
| O6 refund/transfer policy | Fri 13 Nov | Finance | Transfer allowed to any future class; refunds handled manually in Stripe |
| O7 HRDC lead time and claim window | Fri 13 Nov | Finance | Ship as editable settings with no default; Ops fills them in |
| O10 certificate numbering | January | Operations | Out of MVP |
| O15 merge `fields` map | Fri 2 Oct | Zixuan + Shawn | The contact fields shown on 9.3: full name, preferred name, email, phone, WhatsApp, job title, language, owner |
| O11 anonymisation = erasure | Fri 9 Oct | Shawn + privacy review | **Decided 9 Oct (v1.12): ship as built, plus the erasure checklist in 12.10.** Privacy review to confirm the wording and what is kept |
| O13 audit_log history | Fri 9 Oct | Shawn + privacy review | **Decided 9 Oct (v1.12): leave audit rows as they are for go-live; `audit_log` readable by super_admin only; controlled redaction considered in January** |
| O14 personal data in URLs | Fri 16 Oct | Shawn | **Decided 13 Oct (v1.18): keep only utm_*, gclid, fbclid and the path; drop other query parameters at capture, on every capture path.** Built for the public form (`cleanUrl()`, the only code that stores a URL today). The n8n Lead Ads and WATI intakes (Shawn, not built) must use the same function; follow-up when they are built |
| O12 payment record retention | Fri 13 Nov | Finance / accountant | Keep payment rows indefinitely; erasure never touches them |
| O16 part payments and HRDC timing | Fri 16 Oct | Finance | Build as written in 9.12: confirm only when payments reach the price; HRDC recorded when the money arrives |
| O23 match_payment task link | Tue 13 Oct | Shawn | Add `task.payment_id` with a CHECK and a one-open-task-per-payment unique index. Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-01. |
| O24 Nameless WhatsApp person | Tue 13 Oct | Shawn + Zixuan | No DDL. Keep `full_name` NOT NULL; the WhatsApp intake writes the WhatsApp profile name or the phone as received, sets `needs_review` with reason `no_name`, and the UI shows the phone. Written into §11.2 (v1.11). See S-02 in the review. |
| O25 Payment integrity | Tue 13 Oct | Shawn | Add `refunded_at`, the status/refund/`paid_at` CHECKs, a unique Stripe session index and one `payment_net` revenue view. Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-03. |
| O26 Enrolment status history | Tue 13 Oct | Shawn + Zixuan | Add an append-only `enrolment_status_history` table (24th table), written by a database trigger on `enrolment` so every writer is covered (§3, §12.11). Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-04. |
| O27 Undefined columns | Tue 13 Oct | Shawn + Zixuan | Add `class.notes`, `class.cancelled_reason`, `class.cancelled_at` and `deal.hrdc_document_key`. A trigger stamps `cancelled_at`; `cancelClass()` writes the reason. Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-05. |
| O28 Reservation with no expiry | Tue 13 Oct | Shawn + Zixuan | Covered upstream: migration 007 has the CHECK (`enrolment_reserved_has_hold`) and the backfill. Migration 009 adds only the sweep index. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-06. |
| O29 Touchpoint external ref | Tue 13 Oct | Shawn | Add `touchpoint.external_ref` with a unique index on (channel, external_ref). Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-07. |
| O30 Deal source touchpoint | Tue 13 Oct | Shawn | Add `deal.source_touchpoint_id`, set by public intake, n8n and WATI. Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-08. |
| O31 Idempotency key home | Tue 13 Oct | Shawn | Option A: store the key as `touchpoint.external_ref` (channel `web_form`), no new table; relies on O29 and O30. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-09. |
| O32 Withdrawn vs done HRDC task | Tue 13 Oct | Shawn | Add `task.is_cancelled` flag with CHECK that it implies `done_at`; withdrawals set it and the timeline shows "withdrawn". Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-10. |
| O33 Workers cannot close tasks | Tue 13 Oct | Shawn | Relax the CHECK to `done_by` needs `done_at`; who closed it stays in `audit_log`. Migration 009. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-11. |
| O34 Outbox backoff and dead letters | Tue 13 Oct | Shawn | Add `next_attempt_at`, `dead_at`, `seq` and the due index; same backoff columns on `integration_event`. Built: migration 010. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-12. |
| O35 Erasure gaps | Tue 13 Oct | Shawn | Extend `erase_person` to clear `task.title`, match_payment task notes and `enrolment_status_history.reason` (that table is append-only, so the clearing function needs a controlled exception), and add a retention job that blanks `integration_event.payload`. `audit_log` is settled by O13 (v1.12): old values stay for go-live, and the §12.10 checklist already lists them with Stripe, WATI, the email provider and the proof bucket, so nothing is built for audit. Payment notes and URLs still follow the privacy review and O14. Not built yet. DDL: see docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md, S-13. |
| O36 Expire Stripe link on class cancel | Stripe test keys | Shawn | Shawn will supply the test keys (13 Oct; no date). Keep the no-op port; implement it with the Stripe webhook work. The session id is `deal.checkout_session_id` (no new column). The real call must treat an already expired or completed session as success. |
| O37 Where handler tasks land | Fri 16 Oct | Shawn + Zixuan | **Decided 13 Oct (v1.18): stay assigned to the duty super_admin (v1.17; the longest-serving active one), type `other`, title says what to do; revisit after go-live.** No schema change. A new task type or a different assignee rule would need one before the freeze. |
| O38 Schedule cache | Before go-live | Shawn + Zixuan | The handler stays a no-op until the §10.1 page exists; then the class edit and cancel code call `revalidateTag("public-schedule")` (v1.23). No purge of the feed's 5-minute edge copy: a class edit reaches the marketing site within 5 minutes. |
| O39 CAPTCHA provider | Fri 30 Oct | Shawn + Zixuan | Cloudflare Turnstile (invisible mode available, free, no ad tracking). Built behind a verifier; without a secret the endpoint refuses everything. |
| O40 Rate limit layer | Decided 13 Oct (v1.18) | Shawn | **Keep the app counter (012) and the per-phone count; an edge limiter is optional, later.** Drop `rate_limit_hit` only if an edge limiter is there and tested. Go-live check: verify the client-IP header trust behind DigitalOcean's proxy or load balancer (§14, §15.2). |
| O41 What a form does not save | Fri 16 Oct | Shawn + Zixuan | **Decided 13 Oct (v1.18).** `message` appended to `person.notes`; known people are not updated from a form; staff see the touchpoint and notes on the person. |
| O42 Public API settings | Mon 2 Nov | Shawn + Zixuan | The API stays closed (503) and the schedule feed shows the last cached copy on the website until the five variables are set. |
| O43 /register | Stripe test keys | Shawn | Zixuan builds `/register` and `createCheckoutSession()` on her own test key (v1.24). Shawn's keys (no date) are for the webhook and the go-live test. Until `/register` ships, the website's register page uses the lead form and the checkout link sent from the deal (§7.1). |
| O45 Consent after a withdrawal | Mon 2 Nov | Shawn + privacy review | **Decided 13 Oct (v1.18): the form never re-grants a withdrawn purpose; the lead is still captured; opt-in again only through Ops (staff record a new consent by hand) or a future double opt-in feature (not built).** |
| O46 Idempotency key and submitter | Mon 2 Nov | Shawn | **Accepted 13 Oct (v1.18):** the key is a client-generated UUID of at least 8 characters, and a collision returns another call's ids only. |
| O47 Table access (was: from Supabase roles) | Fri 27 Nov | Shawn | **Decided 13 Oct (v1.18), reworded 14 Oct (v1.19): the Data API concern no longer applies, the database is on DigitalOcean (O48). Before go-live: the database is reachable only from the app and job hosts, TLS is required, and no table is exposed through any REST layer.** Keep 001's posture. Fri 27 Nov stays. Checklist lines in §14 and §15.2. |
| O48 Database location and expiry sweep trigger | Decided 14 Oct (v1.19) | Shawn | **Decided 14 Oct: the database is a PostgreSQL database on DigitalOcean; a scheduled job on DigitalOcean calls `expire_reservations()` every 15 minutes over the same connection (the fallback, adopted). `pg_cron` and Supabase Cron are not used.** |
| O49 Login and file storage after the database moves | Fri 16 Oct (schema freeze) | Shawn | **Decided 16 Oct (v1.20):** keep a Supabase project for sign-in (Supabase Auth) and proof-file storage only; app tables on DigitalOcean; the mapping from each Supabase user id to `app_user.auth_user_id` is documented. No migration needed (no foreign key to `auth.users`). The web app is hosted on Netlify (decided 16 Oct, v1.20; §2 Hosting). |
| O50 `no_name` flag has no exit | Decided 16 Oct (v1.21) | Shawn + Zixuan | A person edit that sends a non-blank `fullName` different from the stored one clears `no_name` (in `updatePerson`, as `phone_unnormalised` is cleared); "Not a duplicate" is refused for `no_name` and `phone_unnormalised` (422 `not_a_pair`) and hidden on 9.2. Zixuan builds both in one change (§7, §12.2). |
| O51 `no_name` never answered | Four weeks after the WhatsApp intake goes live | Shawn + Zixuan | Leave the flag: it stays a to-do. No neutral dismiss until there is volume to judge. Build O50 as written meanwhile. |
| O52 open pair task after a defect fix | Before §9.14 is built | Shawn + Zixuan | Leave the task as the to-do: it is assigned to the duty super_admin, shows on Home, and a merge closes it. "Not a duplicate" stays refused for `phone_unnormalised` and `no_name`. §9.14 can add closing a pair task as "not a duplicate". |
| O53 Stripe refunds | Before the first real refund | Shawn + Finance | Ops record refunds by hand; the events are stored `ignored` |
| O54 amount rule | Stripe test keys | Shawn + Finance | As built: balance only, anything else unmatched |
| O55 `checkout_expired` | Go-live | Shawn | As built: no Ops task |
| O56 webhook creates no person | Go-live | Shawn | As built |
| O57 integrations job | Go-live | Shawn | Run `npm run integrations:process` by hand after an incident |
| O58 part-payment rule location, `PaymentRecorded` | O16 answer | Shawn + Finance | Leave as built |

O23-O35 (added 8 Oct, from the pre-freeze schema review) are dated Tue 13 Oct, three days before the 16 Oct freeze. O36-O38 (added 9 Oct, with the first handlers), O39-O43 (added 9 Oct, with the public API), O45-O47 (added 13 Oct, from the review of both), O48 (added 13 Oct, after the hosting decision) and O49 (added 14 Oct, after the database decision) are dated in the calendar. O3, O9, O14, O37, O40, O41, O45, O46 and O47 were decided on 13 Oct (v1.18), and O48 on 14 Oct (v1.19); the rows stay, marked decided. O17-O19, O21 and O44 (added 7 Oct; O44 was numbered O16 until 13 Oct, when upstream used O16 for part payments) remain undated until Shawn sets dates. O20 and O22 were closed on 9 Oct (see above).

The two that matter this week are **O8** and **O1**. O8 is the only item that can stop a whole sprint — Zixuan can't build Section 10 against a website she can't deploy to.

**Companies — decided 24 Sep (v1.5).** From Zixuan's 9.4 question. Recorded so nobody re-asks.
- Create and edit company, and attaching people, are MVP. They were already in §7 (contract C2) and §9.2; 9.4 now shows the controls.
- Ending a membership: MVP, via PATCH …/members/:membershipId with `endDate`. Changing a person's company on 9.2 uses `replaceCurrent` — old membership ended, new one created, one transaction.
- Duplicate companies: no hard-match rule in MVP. "Similar companies" warning on Add company only.
- Company merge: January.
- Company delete (soft or hard): January. `company.deleted_at` stays unused until then.
- Public forms never create companies (§8.2 step 3a).

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
