# lib/db — LEAD CRM schema

Owner: Shawn. Spec Section 5 is the contract; this folder is its implementation.
Schema frozen from 16 Oct — changes after that go through Shawn.

`migrations/001_schema_v1.sql` is Section 5 of the spec (v1.2) as PostgreSQL. It was
applied to a clean PostgreSQL 16 database, and `tests/schema_constraints.sql`
passed 38 of 38 checks against it. The test script rolls itself back.

    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/001_schema_v1.sql
    psql -d <db> -f lib/db/tests/schema_constraints.sql

The tests live outside `migrations/` on purpose, so no migration runner ever executes them.

23 tables, one view (`consent_current`), seed rows for `lost_reason` and `app_setting`.

## Where this is stricter or more specific than the spec

Match these in your mock layer so nothing surprises you when the real schema lands.

| Table | Rule in the SQL | Why |
| --- | --- | --- |
| person | `email_norm` is a **generated column** — the app never writes it | It can't drift from `email` |
| person | `phone_e164` must look like E.164 (`+60123456789`) | Catches un-normalised writes |
| person | email/phone uniqueness ignores deleted **and merged-away** rows | So a merge can keep the survivor's values |
| touchpoint, consent, deal_stage_history, audit_log | UPDATE and DELETE raise an error | Spec says append-only; now the database enforces it |
| touchpoint | at most one `is_first_touch` per person | First touch is set once |
| class | venue fields required unless `online`; `online_url` required unless `in_person` | Spec 9.9 validation, enforced in the database too |
| enrolment | double-booking index also excludes `transferred` rows | Otherwise a person transferred out of a class could never re-book it |
| enrolment | `transferred` requires `transferred_to_enrolment_id`; `completed` requires `completed_at` | |
| deal | stage must belong to the pipeline; `lost` needs `lost_reason_id` and `lost_at`; `won` needs `won_at` | Spec 12.5 |
| deal | corporate deals past `discovery` need company, headcount and funding type | Spec 12.5 |
| deal | has `deleted_at` | Not listed in Section 5, but deals are user-facing and the soft-delete convention applies |
| payment | manual methods need `reference_no` **and** `proof_file_key` | Spec 9.12 makes both required |
| payment | only Stripe payments can be `unmatched` | Bank/HRDC payments are always recorded against an enrolment |
| payment | currency must be MYR; refunds can't exceed the amount | |
| class_notice | only one `pending` per class; `approved`/`sent` need `approved_by` + `approved_at` | Spec 5 rule on notices |
| task | `review_duplicate` needs two different people; `done_at` and `done_by` set together | |
| tag, app_user | names/emails unique case-insensitively | |
| message_log | `external_message_id` unique per channel | Webhook replay protection |
| integration_event | unique on (`source`, `external_event_id`) | Webhook idempotency |

## Things the app must still do (the database can't)

- **Phone normalisation** — libphonenumber in `/lib/format`, then write `phone_e164`.
- **Seat counting and `class.status`** — computed in the service inside a transaction that locks the class row (Spec 12.1).
- **Merging people with overlapping tags** — `person_tag` has a primary key on (person, tag), so move tags with `INSERT ... ON CONFLICT DO NOTHING` before deleting the loser's rows.
- **`person.last_activity_at`** — via `touchPersonActivity()` (Spec 12.9).

## Seed values

`app_setting` holds the decision-calendar fallbacks: 48-hour reservations,
60-minute SLA, 8-hour idle timeout. The HRDC values are `null` until
Finance supplies them (open item O7).
