# lib/db — LEAD CRM schema

Owner: Shawn. Spec Section 5 is the contract; this folder is its implementation.
Schema frozen from 16 Oct — changes after that go through Shawn.

`migrations/001_schema_v1.sql` is Section 5 of the spec (v1.2) as PostgreSQL. It was
applied to a clean PostgreSQL 16 database, and `tests/schema_constraints.sql`
passed 38 of 38 checks against it. The test script rolls itself back.

    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/001_schema_v1.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/002_merge_erase.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/003_company_from_form.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/004_hrdc_task_guard.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/005_row_version.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/006_class_seats.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/007_reservation_holds.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/008_payment_proof_unique.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/009_pre_freeze_schema.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/010_outbox_backoff.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/011_task_source_key.sql
    psql -d <db> -v ON_ERROR_STOP=1 -f lib/db/migrations/012_rate_limit.sql
    psql -d <db> -f lib/db/tests/schema_constraints.sql
    psql -d <db> -f lib/db/tests/002_merge_erase_tests.sql
    psql -d <db> -f lib/db/tests/003_company_from_form_tests.sql
    psql -d <db> -f lib/db/tests/004_hrdc_task_guard_tests.sql
    psql -d <db> -f lib/db/tests/005_row_version_tests.sql
    psql -d <db> -f lib/db/tests/006_class_seats_tests.sql
    psql -d <db> -f lib/db/tests/007_reservation_holds_tests.sql
    psql -d <db> -f lib/db/tests/008_payment_proof_unique_tests.sql
    psql -d <db> -f lib/db/tests/009_pre_freeze_tests.sql
    psql -d <db> -f lib/db/tests/010_outbox_backoff_tests.sql
    psql -d <db> -f lib/db/tests/011_task_source_key_tests.sql
    psql -d <db> -f lib/db/tests/012_rate_limit_tests.sql

Current result on PostgreSQL 16 with 001–008 applied: 38 of 38, 42 of 42, 26 of 26, 8 of 8, 9 of 9, 26 of 26, 14 of 14 and 6 of 6. 001–007 were also run with and without Supabase's `anon`/`authenticated` roles present; 008 was run without them (it creates no functions, so privileges don't apply).

With 001–012 applied on PostgreSQL 17 (empty database, 13 Oct, on `feat/s1-stack`): `schema_constraints.sql` 38 of 38, 002 42, 003 26, 004 8, 005 9, 006 26, 007 14, 008 6, 009 55, 010 16, 011 9, 012 13 (all passed). Upstream's 008 test needed `paid_at` on its succeeded payments once 009 added the payment CHECKs. The scripts need an empty database, not a seeded one.

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

## Migration 004 — HRDC deadline task guard (28 Sep)

At most one open `hrdc_deadline` task per deal (unique index on `deal_id` where `type = 'hrdc_deadline'` and `done_at IS NULL`), and an `hrdc_deadline` task must have a `deal_id`. The app still creates and updates the task (spec 12.6); a second insert while one is open fails with a unique violation — catch it and update the open task instead.

## Migration 005 — row version for If-Match (1 Oct)

| Change | What it means for the app |
| --- | --- |
| `version bigint NOT NULL DEFAULT 1` | Added to the 15 editable tables: `app_user`, `app_setting`, `person`, `company`, `company_membership`, `tag`, `course`, `class`, `class_notice`, `lost_reason`, `deal`, `enrolment`, `payment`, `enquiry`, `task`. Not added to `message_log`, `event_outbox`, `integration_event` (the system writes those). |
| `bump_version()` trigger | Adds exactly 1 on every UPDATE, even one that changes nothing. The app cannot choose the value: anything it writes is overwritten. |
| How to use it | GET returns `version`; send it back as `If-Match`. PATCH runs `WHERE id = $1 AND version = $2`. Zero rows updated = 409 (or 404 if the row is gone). Do not compare `updated_at`: a JS `Date` keeps milliseconds, Postgres keeps microseconds, so the match silently fails; and `updated_at::text` depends on the session timezone. |
| Merge | `merge_person()` updates the survivor, so its version goes up and any edit form opened before the merge gets a 409. |

## Migration 006 — seats and class status (5 Oct)

Enrolments are written by the app, the Stripe webhook, the SalesProcess import and by hand. Seat rules have to hold for all of them, so they live here.

| Change | What it means for the app |
| --- | --- |
| `class_seats_taken(class)` | The one definition of a taken seat (§12.1): reserved **and not expired**, payment_pending, confirmed, onboarded, attended, completed. Don't write a second version in TypeScript. |
| `class.status` maintained by triggers | Recomputed on every enrolment insert/delete/status/class change and on capacity or threshold edits. Only touches `open`/`few_seats`/`full`; `draft`, `cancelled`, `completed` are never changed. To publish, set `open` — the database corrects it to `few_seats`/`full` in the same update. The app never computes status itself. |
| Oversell guard | Any write that claims a seat on a full class raises `no_seats: class <code> is full` (SQLSTATE P0001) — map it to 409 `no_seats`. Moves between seat-taking statuses (confirmed → onboarded) never trip it. Cancelled and completed classes are exempt, so history can be imported. Keep the service's own seat check for a friendly early message, but the database is the authority. |
| `seat_reserved_until` | Filled automatically for any `reserved` row left empty: now + `reservation_expiry_hours` (48). The public register route sets it itself to now + `stripe_reservation_hours` (24) and passes the same time to Stripe as `expires_at`. |
| `expire_reservations()` | Cancels expired reservations (`cancelled_reason = 'reservation_expired'`) and writes `EnrolmentCancelled`. Scheduled on Supabase: `select cron.schedule('expire-reservations', '*/15 * * * *', $$select expire_reservations()$$);`. Between runs the seat count already ignores expired rows; only the badge can lag, by up to 15 minutes. |
| `ClassPublished` | Written by the database whenever `status` or `is_public` changes, including seat-driven changes. **The app no longer raises it.** |
| Locking | The triggers lock the class row. The service's transaction already does, so this costs nothing there. Every status change bumps `class.version`, so an open class edit form can get a 409 while bookings arrive — expected. |
| Privileges | `class_seats_taken`, `refresh_class_status`, `expire_reservations` revoked from PUBLIC/`anon`/`authenticated` — the public feed must never expose raw seat counts (§8.1). |

## Migration 007 — every reservation has a hold (6 Oct)

From Zixuan's review of 006. Both bugs were reproduced locally before the fix.

| Change | What it means for the app |
| --- | --- |
| Backfill at install | `reserved` rows written before 006 had no `seat_reserved_until`: they held no seat, the sweep skipped them, and the double-booking index stopped that person re-booking. 007 gives each one `created_at` + 48h, then runs the sweep once. Old ones end up `cancelled` / `reservation_expired`; recent ones keep the rest of their 48h. If a backfill would oversell a class, the migration stops with `no_seats` and the class code — nothing is cancelled silently. |
| CHECK `enrolment_reserved_has_hold` | A `reserved` row must have a hold. The 006 trigger still fills it for any writer that leaves it empty, so writers don't change. |
| Seat guard fix | In 006, a no-hold reservation that later got a hold skipped the oversell check (`NULL <= now()` is NULL). Now a missing hold counts as "held no seat", so the check runs. |
| `backfill_reservation_holds()` | Used once by the migration. Revoked from PUBLIC/`anon`/`authenticated`. |
| Imports | Don't import `reserved` rows from SalesProcess — map them to `cancelled`. Otherwise the trigger gives them a fresh 48h hold and they take seats. |

## Migration 008 — one proof file, one payment (9 Oct)

From Zixuan's 9.12 questions (manual payment modal).

| Change | What it means for the app |
| --- | --- |
| Unique index `payment_proof_key_uq` on `payment.proof_file_key` where not null | The same uploaded proof cannot be saved on two payments, so a double-click or retry on the modal can't record it twice. The error message contains `payment_proof_key_uq`; show "already recorded". Payments with no proof (Stripe) are not limited. |
| If it fails to build | Two existing payments share a proof file. The header of the migration has the query that lists them; a person decides which row is real. Nothing is changed for you. |
## Migration 009 — pre-freeze schema (8 Oct, renumbered 13 Oct)

The gaps found by the pre-freeze review (`docs/superpowers/notes/2026-10-08-pre-freeze-schema-review.md`), decisions O23–O30, O32 and O33. One transaction; safe to re-run. It was written as 006 and is 009 because `feat/classes` already uses 006 (seats), 007 (reservation holds) and 008 (proof uniqueness); it has no seat or expiry logic of its own.

| Change | What it means for the app |
| --- | --- |
| `task.payment_id` (S-01, O23) | A `match_payment` task must have `payment_id`, and only one can be open per payment (`task_match_payment_open_uq`). The Stripe worker sets it; `POST /api/payments/:id/match` finds the task by it. A second insert for the same payment fails with a unique violation — treat it as "already open". |
| `task.is_cancelled` (S-10, O32) | Withdrawing a task (the HRDC reminder when a deal leaves funding, a `match_payment` task whose payment was refunded) sets `done_at` **and** `is_cancelled = true`. `is_cancelled` without `done_at` is refused. `done_at IS NULL` still means "open" everywhere. Show "withdrawn", not "done". |
| `task_done_by_needs_done_at` (S-11, O33) | Replaces 001's "`done_at` and `done_by` set together". `done_by` still needs `done_at`, but a task can now be closed with `done_by` NULL — that is how a worker (system actor, §4) closes one. |
| payment CHECKs (S-03, O25) | `succeeded`, `partially_refunded` and `refunded` need `paid_at` (the manual payment modal writes its payment date). Status must match the refunded amount: `refunded` = full amount, `partially_refunded` = more than 0 and less than the amount, any other status = 0. `refunded_at` (new, the last refund) is set exactly when `refunded_amount_myr > 0`. |
| `payment_stripe_session_uq` | `stripe_checkout_session_id` is unique, so the checkout webhooks can look a payment up by session. |
| view `payment_net` | The one revenue definition (spec 12.7): `succeeded`, `partially_refunded` and `refunded` payments with `net_myr = amount_myr - refunded_amount_myr`. Pending and failed are not in it. Lifecycle, company totals and BI should read it instead of their own status lists. |
| `enrolment_status_history` (S-04, O26) | The 24th table, append-only like `deal_stage_history` (`from_status`, `to_status`, `reason`, `changed_by`, `changed_at`). **A database trigger on `enrolment` writes it** — on insert (`NULL → reserved`) and on every status change — so the status/transfer/cancel routes, a class cancel, `expire_reservations()`, the Stripe worker and imports all get a row without writing one. **Writers must not insert into it.** `reason` is the cancel reason when the new status is `cancelled`; `changed_by` stays NULL (the database does not know the actor; the `audit_log` row of the move has it). `changed_at` defaults to `clock_timestamp()`, so two changes in one transaction stay in order. No `version` column: the system writes it. Because of the foreign key, an enrolment that has ever existed cannot be DELETEd: cancel it. |
| `class.notes`, `class.cancelled_reason`, `class.cancelled_at` (S-05, O27) | `cancelClass` writes the reason; a trigger stamps `cancelled_at` whenever a class becomes `cancelled` (any writer), and `class_cancelled_at_recorded` keeps it set. There is deliberately no CHECK on the reason: the database cannot invent one. `notes` is internal: the public schedule feed never selects it. |
| `deal.hrdc_document_key` (S-05) | Storage key of the uploaded HRDC document. |
| `enrolment_reservation_expiry_idx` (S-06) | Partial index (`seat_reserved_until` where `status = 'reserved'`) for the `expire_reservations()` scan. The "reserved has a hold" CHECK is 007's `enrolment_reserved_has_hold`; 009 does not repeat it. |
| `touchpoint.external_ref` (S-07, O29) | Unique per `channel` when set: `<batch>:<row>` for the import, `leadgen_id`, the WATI message id, the public form's `idempotencyKey`. Insert with `ON CONFLICT DO NOTHING`. It is frozen like every other touchpoint column, even during a merge. |
| `deal.source_touchpoint_id` (S-08, O30) | The touchpoint that created the deal. Public intake, n8n and WATI set it; hand-made deals leave it NULL. |

Backfills, run before each constraint:

- `enrolment_status_history` gets one row per existing enrolment: `NULL →` current status, `changed_at` = the enrolment's `created_at`, reason `migration 009 backfill`.
- `cancelled` classes get reason `migration 009 backfill` and `cancelled_at` = `updated_at`.
- Payments: `paid_at` = `created_at` where a paid status has none; `refunded_at` = `updated_at` where something was refunded.
- Payments whose status and refunded amount disagree (for example `partially_refunded` with 0 refunded) are **not** repaired: the migration stops and names the count. Same for a checkout session id used twice. Fix those rows by hand and re-run.
- The backfill UPDATEs bump `version` and `updated_at` on every `payment` and `class` row they touch. Edit forms opened before the migration get a 409.

## Migration 010 — outbox backoff (9 Oct, renumbered)

Open item O34, finding S-12 of the pre-freeze review. Shawn-only plumbing: `lib/events/drain.ts` changes with it, `raiseEvent` does not. One transaction; safe to re-run. Written as 007, now 010.

| Change | What it means |
| --- | --- |
| `event_outbox.next_attempt_at` | A row is claimed only when this is due (`<= now()`). A failure sets it to `now()` + `BACKOFF_SECONDS[n-1]` (30 s, 2 min, 10 min, 1 h; the schedule lives in `drain.ts`). Before this a failing row was re-claimed at once and burned all 5 attempts in milliseconds. |
| `event_outbox.dead_at` | Set by the failure that reaches `MAX_ATTEMPTS` (5). A dead row stays pending (`processed_at` NULL) and visible; it is never claimed. `event_outbox_dead_is_pending` refuses dead + processed together. Health panel and BI count dead rows with `dead_at IS NOT NULL`, not with the number 5. |
| `retryDeadEvents(ids?)` | In `drain.ts`, for the §11.4 Retry button: clears `dead_at`, resets `attempts` to 0, `next_attempt_at = now()`; all dead rows when `ids` is omitted. Returns the rows revived. `last_error` is kept until the next success. |
| `event_outbox.seq` | `bigint GENERATED ALWAYS AS IDENTITY`. `created_at` is the transaction's start time, so two events raised in one transaction tie; the claim orders by `next_attempt_at, seq`. Never write it. |
| `event_outbox_due_idx` | `(next_attempt_at, seq) WHERE processed_at IS NULL AND dead_at IS NULL`. Replaces `event_outbox_pending_idx`, which included dead rows. |
| `integration_event.attempts`, `next_attempt_at`, `integration_event_due_idx` | The same retry columns for the webhook staging table (index on `next_attempt_at` where `status IN ('received','failed')`). Nothing uses them yet. |

`drainOutbox` now returns `{ claimed, processed, failed, dead }`; `npm run events:drain` prints `claimed N processed N failed N dead N` and exits 1 when anything failed.

Backfills:

- `seq` for existing rows follows `(created_at, id)`. Adding an identity column to a populated table fills it in unspecified order, so the migration adds a plain `bigint`, numbers it with `row_number()`, makes it `NOT NULL`, attaches the identity and starts the sequence after the highest number. It is skipped once the column exists, so a re-run never renumbers.
- Pending rows with `attempts >= 5` get `dead_at = now()`: they were dead letters under the old rule. Nothing is deleted; revive them with `retryDeadEvents()` once the cause is fixed. The UPDATE bumps `updated_at`.
- `next_attempt_at` on existing rows is the migration time, so every pending row is due at once; `seq` keeps their order.

## Migration 011 — task source key (9 Oct, renumbered 13 Oct)

For the outbox handlers (`lib/events/handlers.ts`, spec §11.1). One transaction; safe to re-run; no backfill.

| Change | What it means |
| --- | --- |
| `task.source_key` | NULL for every task a person creates. A handler writes `<event id>:<what>[:<enrolment id>]` and inserts with `ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`, so running an event twice opens one task, not two. |
| `task_source_key_uq` | Unique where not null, and not limited to open tasks: a task that was done is not recreated by a repeat. |

## Migration 012 — rate-limit counter (9 Oct, renumbered 13 Oct)

For the public intake API (`lib/public/guard.ts`, spec §8.2). One transaction; safe to re-run; no backfill.

| Change | What it means |
| --- | --- |
| `rate_limit_hit` (unlogged) | One row per (bucket, one-minute window) with a hit count. The bucket is a hash of the caller's IP keyed with the server-only `RATE_LIMIT_SECRET`, never the address. Unlogged: a crash may reset the counters, nothing else. |
| `rate_limit_take(bucket, window_seconds)` | Counts one hit in the current window and returns the total. Atomic. Deletes rows older than an hour first, so no cleanup job is needed. Not callable by `anon`/`authenticated`. |

Drop the table and function if the host gets an edge rate limiter you trust (open item O40).

## Where this is stricter or more specific than the spec

Match these in your mock layer so nothing surprises you when the real schema lands.

| Table | Rule in the SQL | Why |
| --- | --- | --- |
| person | `email_norm` is a **generated column** — the app never writes it | It can't drift from `email` |
| person | `phone_e164` must look like E.164 (`+60123456789`) | Catches un-normalised writes |
| person | email/phone uniqueness ignores deleted **and merged-away** rows | So a merge can keep the survivor's values |
| touchpoint, consent, deal_stage_history, enrolment_status_history, audit_log | UPDATE and DELETE raise an error | Spec says append-only; now the database enforces it |
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
| task | `review_duplicate` needs two different people; `done_by` needs `done_at` (since 009, `done_at` may have no `done_by`: a worker closed it) | |
| task | `match_payment` needs `payment_id`, one open per payment; `is_cancelled` needs `done_at` | 009 |
| payment | status, `paid_at`, `refunded_amount_myr` and `refunded_at` must agree; checkout session id unique | 009 |
| class | `cancelled` always has `cancelled_at` (stamped by a trigger); `cancelled_reason` is written by the cancel service | 009 |
| tag, app_user | names/emails unique case-insensitively | |
| message_log | `external_message_id` unique per channel | Webhook replay protection |
| integration_event | unique on (`source`, `external_event_id`) | Webhook idempotency |

## Things the app must still do (the database can't)

- **Phone normalisation** — libphonenumber in `/lib/format`, then write `phone_e164`.
- **Seat counting and `class.status`** — done by the database since migration 006. The service still locks the class row and checks seats for a friendly message; it must map `no_seats` (P0001) to 409.
- **Merging** — call `merge_person()`; don't hand-write the moves. Then apply the `fields` map and write it to the audit log.
- **`person.last_activity_at`** — via `touchPersonActivity()` (Spec 12.9).

## Seed values

`app_setting` holds the decision-calendar fallbacks: 48-hour reservations,
60-minute SLA, 8-hour idle timeout. The HRDC values are `null` until
Finance supplies them (open item O7).
