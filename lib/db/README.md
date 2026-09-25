# lib/db — LEAD CRM schema

Owner: Shawn. Spec Section 5 is the contract; this folder is its implementation.
Schema frozen from 16 Oct — changes after that go through Shawn.

`migrations/001_schema_v1.sql` is Section 5 of the spec (v1.2) as PostgreSQL. It was
applied to a clean PostgreSQL 16 database, and `tests/schema_constraints.sql`
passed 38 of 38 checks against it. The test script rolls itself back.

    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/001_schema_v1.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/002_merge_erase.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/003_company_from_form.sql
    psql -d <db> -f lib/db/tests/schema_constraints.sql
    psql -d <db> -f lib/db/tests/002_merge_erase_tests.sql
    psql -d <db> -f lib/db/tests/003_company_from_form_tests.sql

Current result on PostgreSQL 16 with 001–003 applied: 38 of 38, 42 of 42 and 26 of 26 (with and without Supabase's `anon`/`authenticated` roles present).

The tests live outside `migrations/` on purpose, so no migration runner ever executes them.

23 tables, one view (`consent_current`), seed rows for `lost_reason` and `app_setting`.

## Migration 002 — merge, erase, soft delete (24 Sep)

| Change | What it means for the app |
| --- | --- |
| `person.needs_review_reason` | One of `phone_unnormalised`, `possible_duplicate_company`, `possible_duplicate_email`, `possible_duplicate_phone`, `no_name`. A CHECK ties it to `needs_review`: set both or neither. |
| `person.erased_at` | Set by `erase_person()`. Erased people also get `deleted_at`, so normal lists hide them. |
| `merge_person(source, target, actor)` returns jsonb | Call it inside the merge route's transaction. It moves everything from source to target and marks source `merged_into_id = target`. It returns row counts and `first_touchpoint_id`. Apply the `fields` map (which values to keep) **after** it returns — the source is already merged, so its email/phone no longer block the unique indexes. |
| Merge rules in the function | Refuses: no actor, self-merge, either person missing/merged/deleted/erased, both people active in the same class (error lists the class codes — resolve the enrolment first). Earliest touchpoint becomes the only first touch. **Any opt-out wins**: if either person had opted out of a purpose, the kept person ends up opted out. Shared tags kept once; duplicate company memberships collapse to the target's. The `review_duplicate` task for the pair is closed, not moved. One `audit_log` row, action `merge`. |
| `erase_person(person, actor, reason)` | PDPA erasure = anonymise. Clears name (becomes "Erased person"), email, phones, job title, notes, WATI/Stripe ids, message bodies, enquiry summaries, task notes, tags. **Keeps** enrolments, payments, touchpoints and consent so revenue and attribution still add up. Records previously merged into this person are anonymised too (they still hold the old name/email). Audit row stores the reason and a count only, no personal data. |
| `soft_delete_person(person, actor, reason)` | For junk/test records only. Refused if the person has any enrolment or payment — use erase instead. The audit row stores the reason, not a copy of the record (`audit_log` is append-only, so anything written there can never be erased). |
| Append-only exception | `touchpoint` and `consent` may have `person_id` / `is_first_touch` updated **only** while `lead.merge_in_progress` is `on`, which `merge_person()` sets and clears within its transaction. Every other column, every DELETE, and `audit_log` / `deal_stage_history` stay frozen. This guards against accidents, not against someone with direct database access who sets the flag on purpose. |
| Function privileges | EXECUTE is revoked from PUBLIC and, on Supabase, from `anon` and `authenticated`, so the functions cannot be called through the Data API with the publishable key. Call them from the server via `DATABASE_URL`. `actor` is trusted — pass the signed-in user's id from the session, never a value from the request body. |

## Migration 003 — company name from the lead form (24 Sep)

| Change | What it means for the app |
| --- | --- |
| `normalise_company_name(text)` | The one rule for "same company name": lowercase; `(M)`, `(Malaysia)`, 有限公司, punctuation, spaces and the words sdn/bhd/berhad/plt removed. `Acme (M) Sdn. Bhd.` = `ACME SDN BHD` = `acme`. Placeholders (N/A, none, self-employed, student…) give `null`. Use it for the §12.2 soft match too — don't write a second version in TypeScript. |
| `company.name_norm` | Generated from `legal_name`; the app never writes it. Indexed. Use it to show "similar companies" on Add company. |
| `person.company_name_given` | What the person typed on the latest public form (max 200). Informational — memberships are the truth. |
| `link_company_from_form(person, typed name)` returns uuid or null | Call it from POST /api/public/leads and /register, in the same transaction, after the person is found or created. Stores the text; links to a company **only** if the person has no current membership and exactly one live company has the same `name_norm`. **Never creates a company.** |
| `erase_person()` | Re-created: now also clears `company_name_given`. |
| Privileges | `link_company_from_form` and `erase_person` revoked from PUBLIC/`anon`/`authenticated`. `normalise_company_name` stays callable — it reads and changes nothing. |

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
- **Merging** — call `merge_person()`; don't hand-write the moves. Then apply the `fields` map and write it to the audit log.
- **`person.last_activity_at`** — via `touchPersonActivity()` (Spec 12.9).

## Seed values

`app_setting` holds the decision-calendar fallbacks: 48-hour reservations,
60-minute SLA, 8-hour idle timeout. The HRDC values are `null` until
Finance supplies them (open item O7).
