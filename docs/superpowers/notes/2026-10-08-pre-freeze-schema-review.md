# Pre-freeze schema review (findings only)

> **Update 13 Oct 2026.** This review was written against spec v1.7 and migrations 001-005. `feat/classes` has since taken migrations 006 (class seats) and 007 (reservation holds), so what this document calls "006" was built as **009_pre_freeze_schema.sql** and "007" as **010_outbox_backoff.sql** (upstream also took 008 for payment proof uniqueness); the index group it calls "008" is not built. S-06 is covered by upstream 007 (009 adds only the sweep index). The open item this document calls O16 is O44 in the spec now, because upstream used O16 for part payments. Upstream decided O2, O11 and O13 on 9 Oct (spec v1.12): message bodies are not stored, anonymisation ships as built with an erasure checklist for outside systems (§12.10), audit rows stay for go-live and `audit_log` is readable by super_admin only. That settles the audit part of S-13(f); the rest of S-13 stands. S-04 was built as a database trigger, not as application writes. S-13 is not built. The DDL below is the original recommendation; the migrations are the record of what exists.

Date: 8 Oct 2026 · For: Shawn (schema owner) · Freeze: 16 Oct 2026 (spec §1 rule 1, §3 C1)

Reviewed on `feat/s1-integration`: spec v1.7 (`LEAD-CRM-Spec-v1.0.md`, line numbers below are from that copy), v1.8 delta on `docs/s1-spec-delta` (O16–O22), migrations 001–005, `lib/db/tests/*.sql`, `lib/**`, `app/api/**`, `scripts/seed-dev.ts`, `tests/*`. Read only. No database was connected and no tests were run, so every "breaks" below is from reading the code, not from a run.

Severity: **BLOCKS-FREEZE** = Zixuan will code against the gap during S2–S4, or data written before the fix can't be repaired. **SHOULD** = cheap now, costly later. **NICE** = no contract impact, do it any time. **OK** = checked, fine.

A note that applies throughout: indexes, and changes to tables only Shawn's code touches (`event_outbox`, `integration_event`), don't change what Zixuan codes against. They still count as §5 changes under the freeze rule. See question Q1.

## 1. Summary

| ID   | Finding                                                                                                                                  | Severity                     | Who is affected                                                  | Migration                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| S-01 | A `match_payment` task has no way to point at its payment, so `POST /api/payments/:id/match` can't find the task it has to close         | BLOCKS-FREEZE                | Shawn's Stripe worker (S2), Zixuan's match screen and route (S4) | Y (006)                       |
| S-02 | A WhatsApp-only person with no name can't be stored: `full_name` is NOT NULL and can't be blank. No rule says what to write instead      | BLOCKS-FREEZE (decision)     | Shawn's WATI intake (S2), every Zixuan screen that shows a name  | N (if convention)             |
| S-03 | Payment rows can contradict themselves (status vs refunded amount, `paid_at`). No refund date. Three code paths define "paid" three ways | SHOULD                       | Shawn's Stripe worker, Zixuan's manual payment, lifecycle, BI    | Y (006)                       |
| S-04 | Enrolment status has no history and no transition times. The timeline's "enrolment changes" only shows the current status                | SHOULD                       | Zixuan's enrolment routes (S4), reserveSeat, the sweep, BI       | Y (006)                       |
| S-05 | The spec uses columns §5 never defines: class internal notes, class cancel reason, HRDC document key                                     | SHOULD                       | Zixuan 9.6, 9.8–9.10 (S2)                                        | Y (006)                       |
| S-06 | A `reserved` enrolment with NULL `seat_reserved_until` holds its seat forever, and no sweep can find it                                  | SHOULD                       | Zixuan's `POST /api/enrolments`, the sweep                       | Y (006)                       |
| S-07 | Touchpoints are append-only and have no external reference. A repeated import can never be undone or deduplicated                        | SHOULD                       | Shawn's import (S4), n8n Lead Ads, WATI                          | Y (006)                       |
| S-08 | A deal doesn't record the touchpoint that created it, so campaign-to-revenue reports have to guess                                       | SHOULD                       | Shawn's public intake and reporting views                        | Y (006)                       |
| S-09 | The public-form `idempotencyKey` has no home. `integration_event` can't hold it cleanly                                                  | SHOULD                       | Shawn's `/api/public/leads` and `/register`                      | Y (via S-07+S-08, or a table) |
| S-10 | A withdrawn HRDC task looks the same as a completed one. It matters, because the timeline shows "Task done"                              | SHOULD                       | Zixuan (`hrdc-task.ts`, timeline), reports                       | Y (006)                       |
| S-11 | `done_at` requires `done_by`, so a worker (system actor = NULL, §4) can never close a task                                               | SHOULD                       | Shawn's workers                                                  | Y (006)                       |
| S-12 | `event_outbox` has no backoff, no dead-letter marker and no stable order. A failing row burns all 5 attempts in milliseconds             | SHOULD                       | Shawn (`drain.ts`, health panel)                                 | Y (007)                       |
| S-13 | Erasure leaves personal data behind: `integration_event.payload`, `task.title`, unmatched-payment task notes, URLs (O14), audit (O13)    | SHOULD                       | Shawn (`erase_person`, retention), privacy review                | Y (007, functions)            |
| S-14 | Rate limits (10/IP/min, 3/phone/hour) have nowhere to count                                                                              | NICE (if edge + touchpoints) | Shawn's public API                                               | N (recommended)               |
| S-15 | Index gaps on FKs and lookups. The trigram index exists, but the search query can't use it                                               | NICE                         | nobody's code                                                    | Y (008, any time)             |
| S-16 | The WATI/enquiry path has no lookup index or one-open-enquiry guard, `channel` has no CHECK, and business hours aren't seeded            | NICE                         | Shawn's WATI intake                                              | Y (optional)                  |
| S-17 | The BI tool's "reads the DB directly" has no read-only role or reporting schema                                                          | NICE                         | Shawn (S4/S5)                                                    | N (grants/views)              |
| S-18 | Hygiene: 005 not in a transaction, `needs_review_reason` holds one reason, `audit_log.entity_id` is uuid-only                            | NICE                         | Shawn                                                            | N                             |

Proposed grouping: **006** = tables Zixuan codes against (S-01, 03, 04, 05, 06, 07, 08, 10, 11). **007** = Shawn-only plumbing and functions (S-12, S-13, S-09 if it becomes a table). **008** = indexes (S-15). Each group can land without the others.

## 2. Detail

### S-01 · BLOCKS-FREEZE · `match_payment` task can't reference its payment

- **Evidence.** `task` has `person_id`, `related_person_id`, `deal_id`, `enrolment_id` and no payment column (`001_schema_v1.sql:445-466`). §11.3 (spec line 783): "Shawn's worker creates a task of type `match_payment` holding raw details". §7.1 (line 508): `POST /api/payments/:id/match` "closes the match_payment task". An unmatched payment has no person, deal or enrolment by definition, so none of the existing task columns can carry the link.
- **What breaks.** The match route gets a payment id and has to find its task. The only place left is free text in `task.notes`, which spec §1 rule 3 forbids ("don't stuff it into an existing field"). Two webhooks for the same payment can also open two tasks.
- **DDL (006).**
  ```sql
  ALTER TABLE task ADD COLUMN payment_id uuid REFERENCES payment(id);
  ALTER TABLE task ADD CONSTRAINT task_match_payment_needs_payment
    CHECK (type <> 'match_payment' OR payment_id IS NOT NULL);
  CREATE UNIQUE INDEX task_match_payment_open_uq ON task (payment_id)
    WHERE type = 'match_payment' AND done_at IS NULL;
  ```
  The same pattern as 004's `hrdc_deadline` guard. `merge_person` needs no change.
- **Affected.** Shawn's Stripe worker (S2) sets it. Zixuan's match route (S4) closes the task by `payment_id` and should also set `task.person_id` so erasure can reach it (S-13).
- **Test.** A `match_payment` insert without `payment_id` fails. A second open task for the same payment fails. After the first is done, a new one succeeds.

### S-02 · BLOCKS-FREEZE (decision) · WhatsApp-only person with no name

- **Evidence.** `person.full_name text NOT NULL CHECK (btrim(full_name) <> '')` (`001:74`). §11.2 (line 775) says "Person with no name (WhatsApp-only) — show phone as display name". `needs_review_reason` has a `no_name` value (`002:17-22`), so a no-name row was expected, but nothing says what goes in `full_name`.
- **What breaks.** The WATI worker can't insert the person until a convention exists. If the convention is "make it nullable", Zixuan's code assumes a non-null string everywhere: `fullName: string` types, `lower(p.full_name)` sort (`lib/people/service.ts:60`), `normaliseName` in dedupe (`lib/people/dedupe.ts:61`), merge, and erase. That change would have to come before she builds more on it.
- **Recommendation (no DDL).** Keep NOT NULL. The worker writes the WhatsApp profile name WATI sends, or the phone as received when there is none. It sets `needs_review = true, needs_review_reason = 'no_name'`. The UI shows the phone when `needs_review_reason = 'no_name'`. Write this into §11.2. Known limit: when a reviewer clears the flag, the "placeholder name" marker goes with it. That is acceptable if clearing it means the name was fixed.
- **Alternative (006, only if you prefer it).** `ALTER TABLE person ALTER COLUMN full_name DROP NOT NULL;` with `CHECK (full_name IS NULL OR btrim(full_name) <> '')`, plus `erase_person` and the Zixuan changes above.
- **Test.** The WATI intake test inserts a no-name person and asserts `needs_review_reason = 'no_name'`.

### S-03 · SHOULD · Payment integrity and the revenue definition

- **Evidence.**
  - Nothing ties `status` to `refunded_amount_myr`. Only `refunded_amount_myr <= amount_myr` is checked (`001:401`). A `succeeded` row with a refund, or a `refunded` row with 0 refunded, is accepted.
  - `paid_at` is nullable for `succeeded`, but monthly revenue reports need it.
  - `refunded_amount_myr` is cumulative with no date. A December refund of a November payment silently changes November's net revenue (§12.7, line 884: "Revenue = succeeded payments minus refunds").
  - `stripe_checkout_session_id` isn't unique or indexed. `checkout.session.completed` and `…async_payment_succeeded` webhooks look the payment up by session.
  - Three code paths define "paid" three ways:
    - `lib/people/lifecycle.ts:22` counts `status = 'succeeded'` only, so a customer with a partial refund drops to "student".
    - `lib/companies/service.ts:178` counts succeeded, partially refunded and refunded, net of refunds.
    - `lib/deals/stage-service.ts:154` counts anything not failed or refunded, including pending.
- **DDL (006).**
  ```sql
  ALTER TABLE payment
    ADD COLUMN refunded_at timestamptz,                       -- last refund; see Q4 for a refund table instead
    ADD CONSTRAINT payment_paid_at_when_paid
      CHECK (status NOT IN ('succeeded','partially_refunded','refunded') OR paid_at IS NOT NULL),
    ADD CONSTRAINT payment_refund_matches_status CHECK (
         (status = 'refunded'           AND refunded_amount_myr = amount_myr)
      OR (status = 'partially_refunded' AND refunded_amount_myr > 0 AND refunded_amount_myr < amount_myr)
      OR (status NOT IN ('refunded','partially_refunded') AND refunded_amount_myr = 0)),
    ADD CONSTRAINT payment_refunded_at_when_refunded
      CHECK ((refunded_amount_myr > 0) = (refunded_at IS NOT NULL));
  CREATE UNIQUE INDEX payment_stripe_session_uq ON payment (stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL;
  ```
  Also add one revenue definition as a view, for example `payment_net`: `amount_myr - refunded_amount_myr` for status in (succeeded, partially_refunded, refunded). `lifecycle.ts` and the BI views should both read it.
- **Affected.**
  - Shawn's Stripe worker (S2).
  - Zixuan's manual payment (S4), which must write `paid_at`. 9.12 already collects a payment date.
  - `lifecycle.ts` (Zixuan).
  - Existing tests: `tests/deals-db.test.ts:480` inserts `succeeded` without `paid_at`, and `partially_refunded` with 0 refunded. `lib/db/tests/schema_constraints.sql:108-120` inserts `succeeded` rows without `paid_at`. These fixtures need updating with the migration.
- **Test.** Each CHECK rejects its bad row. A second payment with the same session id fails.

### S-04 · SHOULD · No enrolment status history

- **Evidence.**
  - `enrolment` has `completed_at` and no other transition time (`001:349-371`).
  - The person timeline's "enrolment changes" branch is `SELECT e.updated_at … e.status` (`lib/people/detail-service.ts:289-292`). It shows one row per enrolment with today's status, and `updated_at` moves on any edit, including a worker bumping `onboarding_step`.
  - Deals got `deal_stage_history` for exactly this reason (§5, "enables conversion reporting"). Enrolments have no equivalent, although §15.2 says "illegal transitions corrupt revenue reporting".
- **What breaks.** BI can't answer "confirmed per week", the no-show rate, how many reservations expired, or when a cancellation happened, except by parsing `audit_log` JSON. The person timeline (§7.1) can't show an enrolment's past.
- **DDL (006).** A mirror of `deal_stage_history`. It would be the 24th table.
  ```sql
  CREATE TABLE enrolment_status_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid REFERENCES app_user(id),
    enrolment_id  uuid NOT NULL REFERENCES enrolment(id),
    from_status   text,
    to_status     text NOT NULL,
    reason        text,
    changed_by    uuid REFERENCES app_user(id),
    changed_at    timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX enrolment_status_history_idx ON enrolment_status_history (enrolment_id, changed_at);
  CREATE TRIGGER enrolment_status_history_append_only BEFORE UPDATE OR DELETE
    ON enrolment_status_history FOR EACH ROW EXECUTE FUNCTION forbid_change();
  ```
  `clock_timestamp()` keeps two changes in one transaction in order. A cheaper version is `confirmed_at` + `cancelled_at` columns on `enrolment`, but that loses everything else.
- **Affected.** Every enrolment writer must insert a row in the same transaction:
  - Zixuan's `POST /api/enrolments/:id/status`, transfer and class cancel (S4).
  - `reserveSeat` (`lib/enrolments/reserve.ts`).
  - The expiry sweep.
  - The Stripe worker.

  If the table only appears after Zixuan has written those routes, she has to go back and add the inserts.

- **Test.** `reserveSeat` writes `(NULL → reserved)`. An UPDATE or DELETE on the history table is refused.

### S-05 · SHOULD · Columns the spec uses but §5 doesn't define

- **Evidence.**
  - **Class internal notes.** §8.1 (line 562): "internal notes never in this response". §12.8 (line 888): "Editing capacity, price, or internal notes needs no notice". `class` has no notes column (`001:219-247`).
  - **Class cancel reason.** §7 (line 464): `POST /api/classes/:id/cancel` "Requires reason". The reason only reaches `enrolment.cancelled_reason` and the `ClassCancelled` payload. The class row keeps no reason or date.
  - **HRDC documents.** §2 (line 59) "receipts, HRDC documents" and §7 (line 471) uploads for "Payment proof, HRDC documents". Only `payment.proof_file_key` exists, and nothing holds an HRDC document key.
- **What breaks.** Under rule 3, Zixuan raises each one when she reaches 9.6 and 9.8–9.10 in S2. That is after the freeze.
- **DDL (006).**
  ```sql
  ALTER TABLE class
    ADD COLUMN notes text,
    ADD COLUMN cancelled_reason text,
    ADD COLUMN cancelled_at timestamptz,
    ADD CONSTRAINT class_cancel_recorded
      CHECK (status <> 'cancelled' OR (cancelled_reason IS NOT NULL AND cancelled_at IS NOT NULL));
  ALTER TABLE deal ADD COLUMN hrdc_document_key text;   -- or drop "HRDC documents" from §2/§7 (Q5)
  ```
- **Test.** Cancelling a class without a reason is refused. The schedule feed (§8.1) never selects `class.notes`.

### S-06 · SHOULD · A reservation with no expiry

- **Evidence.**
  - `seatTakenSql` treats `seat_reserved_until IS NULL` as "still holds a seat" (`lib/classes/seats.ts:18-22`).
  - `enrolment.status` defaults to `'reserved'` (`001:358`), and nothing requires an expiry. `lib/db/tests/schema_constraints.sql:82-88` inserts exactly such rows.
  - `reserveSeat` sets the expiry, but Zixuan's `POST /api/enrolments` (S4) isn't obliged to go through it.
- **What breaks.** A reserved row without an expiry never frees its seat (§12.1: "Reservation expires after 48 hours"). A sweep keyed on `seat_reserved_until < now()` can't see it.
- **DDL (006).**
  ```sql
  ALTER TABLE enrolment ADD CONSTRAINT enrolment_reserved_has_expiry
    CHECK (status <> 'reserved' OR seat_reserved_until IS NOT NULL);
  CREATE INDEX enrolment_reservation_expiry_idx ON enrolment (seat_reserved_until)
    WHERE status = 'reserved';                        -- the sweep's scan
  ```
  The fixtures in `schema_constraints.sql:82-88` and `002_merge_erase_tests.sql` that insert default-status enrolments need a `seat_reserved_until` or an explicit status. Alternatively, drop the `'reserved'` default so every caller has to choose a status.
- **Test.** An insert with status `reserved` and no expiry fails.

### S-07 · SHOULD · Touchpoint external reference (import, Lead Ads, WATI)

- **Evidence.**
  - `touchpoint` refuses UPDATE and DELETE (`001:191-192`). The only exception is `merge_person` (`002:37-51`).
  - There is no import batch or source-row column (`001:165-186`).
  - §15.4 S4: import of about 13,000 contacts.
  - Contacts with neither email nor phone can't be hard-matched on a re-run (§12.2).
- **What breaks.** A re-run, or a half-failed run, of the import adds a second set of 13,000 `import` touchpoints, and nothing can delete them. n8n retries of Meta Lead Ads, or WATI message replays, can do the same on a small scale.
- **DDL (006).**
  ```sql
  ALTER TABLE touchpoint ADD COLUMN external_ref text;   -- '<batch>:<row>' for import, leadgen_id, WATI message id, form idempotencyKey (S-09)
  CREATE UNIQUE INDEX touchpoint_external_ref_uq ON touchpoint (channel, external_ref)
    WHERE external_ref IS NOT NULL;
  ```
  The append-only trigger already freezes the new column, because `to_jsonb(NEW) - person_id` covers it. The import inserts with `ON CONFLICT DO NOTHING` and looks up the person through `external_ref` when a row has no contact details.
  `consent` is append-only too. A re-run would duplicate consent rows (latest still wins, so the result is noise rather than error). Guard that in the import with `NOT EXISTS`, or add the same column to `consent`.
  Nothing in the schema stops the import from leaving `last_activity_at` untouched (§12.9). That is a code rule: don't call `touchPersonActivity`.
- **Test.** A duplicate `(channel, external_ref)` fails. An UPDATE of `external_ref` is refused even with `lead.merge_in_progress = on`.

### S-08 · SHOULD · Deal → source touchpoint

- **Evidence.** The `LeadCaptured` payload carries `touchpointId` (`lib/events/types.ts:22-27`), but no column keeps the deal-to-touchpoint link. `deal` has no attribution column (`001:288-325`).
- **What breaks.** Reporting "campaign → deal → revenue" for a person with several deals has to guess, for example "latest touchpoint before `deal.created_at`". The guess is wrong when one submission creates the touchpoint and attaches to an older open deal (§8.2 step 6).
- **DDL (006).** `ALTER TABLE deal ADD COLUMN source_touchpoint_id uuid REFERENCES touchpoint(id);` Public intake, n8n and WATI set it. Deals created by hand leave it NULL. Enquiry convert can optionally copy it.
- **Test.** Public intake sets it to the touchpoint created in the same transaction.

### S-09 · SHOULD · Where the idempotency key lives

- **Evidence.**
  - §4 (line 179) and §8.2 (line 620): "Repeat idempotencyKey → same result, no change". No column stores the key.
  - `integration_event` (`001:529-542`) has `UNIQUE (source, external_event_id)`, but no result column. Its `payload` is NOT NULL, so it would hold the form body (name, email, phone) in a table `erase_person` never touches (S-13).
  - §3 (line 119) also routes public intake straight to the DB, not through staging.
- **Option A (recommended, no table of its own).** With S-07 and S-08 in place, intake writes the form's `idempotencyKey` as `touchpoint.external_ref` (channel `web_form`). A replay hits `touchpoint_external_ref_uq`. The duplicate's transaction rolls back whole, and the handler then looks the result up by `external_ref`: `person_id` from the touchpoint, the deal via `deal.source_touchpoint_id`, and `checkoutUrl` from `deal.checkout_url` for `/register`. Gap: reusing a key with a different body isn't detected. That is fine for MVP.
- **Option B (new table, 007).**
  ```sql
  CREATE TABLE idempotency_key (
    scope         text NOT NULL,          -- 'public_leads' | 'public_register'
    key           text NOT NULL,
    request_hash  text NOT NULL,          -- sha256 of the normalised body; same key, different body -> 422
    response      jsonb,                  -- ids only, never personal data
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
  );
  ```
  Insert it first, inside the transaction. A concurrent duplicate waits on the primary key until the first request commits, then reads `response`. Purge rows older than 7 days.
- **Checkout link.** It is internal, not "callable by an external system", and needs no schema. `reserveSeat` already returns `already_enrolled`. Pass Stripe's `Idempotency-Key` header and reuse `deal.checkout_url`. Expire the previous Stripe session when you generate a new one, or two live links can each be paid.
- **Webhooks.** `integration_event (source, external_event_id)` plus `payment_stripe_intent_uq` are enough: OK.

### S-10 · SHOULD · Withdrawn HRDC task vs completed (§12.6 v1.7, candidate 1)

- **Does it matter? Yes.**
  - The person timeline renders any task with `done_at` as "Task done: HRDC deadline" (`lib/people/detail-service.ts:283-288`), so staff are told a reminder was completed when it was withdrawn.
  - §12.9 counts "task about them completed" as activity. When the 9.14 complete action calls `touchPersonActivity`, any shared "close task" path would count a withdrawal too.
  - "Reminders completed on time" can't be reported.
- **Smallest change.** A flag, not a new state. All `done_at IS NULL` predicates keep meaning "open": `task_hrdc_deadline_open_uq`, `task_open_by_assignee_idx`, Home, the merge function. Nothing else moves.
  ```sql
  ALTER TABLE task
    ADD COLUMN is_cancelled boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT task_cancelled_is_closed CHECK (NOT is_cancelled OR done_at IS NOT NULL);
  ```
- **Code.**
  - `lib/deals/hrdc-task.ts:91` (the `closeOpenTask` UPDATE) adds `is_cancelled = true`.
  - The timeline CASE in `detail-service.ts:286` shows "withdrawn".
  - The same flag also serves a `match_payment` task closed because its payment was refunded.
- **Test.** Extend `004_hrdc_task_guard_tests.sql`:
  - A withdrawn task has `is_cancelled = true` and frees the slot.
  - `is_cancelled` with NULL `done_at` is refused.

### S-11 · SHOULD · Workers can't close tasks

- **Evidence.** `CHECK ((done_at IS NULL) = (done_by IS NULL))` (`001:465`), and `done_by` references `app_user`. §4: `created_by` is "null when system created". §11.2: workers write tasks.
- **What breaks.** The first time a worker auto-closes a task, the CHECK fails. For example: a late webhook matches a payment and closes its `match_payment` task, or the sweep closes something.
- **DDL (006).**
  ```sql
  ALTER TABLE task DROP CONSTRAINT task_check1;   -- confirm the generated name with \d task before relying on it
  ALTER TABLE task ADD CONSTRAINT task_done_by_needs_done
    CHECK (done_by IS NULL OR done_at IS NOT NULL);
  ```
  Who closed a task stays in `audit_log`. A no-DDL alternative is to seed one inactive "System" `app_user` and have workers use its id. Pick one (Q6).
- **Test.** `done_at` set with NULL `done_by` succeeds. `done_by` without `done_at` fails.

### S-12 · SHOULD · Outbox backoff, dead letters, ordering (candidate 2, O21)

- **Evidence.**
  - The claim is `WHERE processed_at IS NULL AND attempts < 5 ORDER BY created_at … FOR UPDATE SKIP LOCKED` (`lib/events/drain.ts:20-25`). It has no time gate.
  - `scripts/drain-outbox.ts` loops until nothing is claimed, so one failing row is retried 5 times back to back in a single run. Within milliseconds it is dead, and a 30-second WATI or ESP outage turns into permanent dead letters.
  - A dead row can only be recognised as `attempts >= MAX_ATTEMPTS`, a TypeScript constant (`drain.ts:5`). The health panel's `queueDepth` (§11.4) and BI would have to hard-code 5.
  - `event_outbox_pending_idx (created_at) WHERE processed_at IS NULL` (`001:527`) includes dead rows. They are the oldest, so every claim scans past them. That is harmless now and grows with each dead row.
  - `created_at` is the transaction's start time and the claim has no tiebreak. Two events raised in one transaction (for example `EnrolmentCreated` then `EnrolmentConfirmed`) can be handled in either order.
- **DDL (007).**
  ```sql
  ALTER TABLE event_outbox
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN dead_at timestamptz,
    ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
  DROP INDEX event_outbox_pending_idx;
  CREATE INDEX event_outbox_due_idx ON event_outbox (next_attempt_at, seq)
    WHERE processed_at IS NULL AND dead_at IS NULL;
  -- same gap on the webhook staging table:
  ALTER TABLE integration_event
    ADD COLUMN attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
  CREATE INDEX integration_event_due_idx ON integration_event (next_attempt_at)
    WHERE status IN ('received','failed');
  ```
- **Drain changes.**
  - Claim `WHERE processed_at IS NULL AND dead_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at, seq`.
  - On failure, set `next_attempt_at = now() + backoff(attempts)`, and `dead_at = now()` when the cap is reached.
  - The §11.4 Retry button clears `dead_at` and resets `attempts`.
- **Affected.** Shawn only: `drain.ts`, `tests/outbox-db.test.ts`. `raiseEvent` doesn't change, so Zixuan is not affected.
- **Test.**
  - A failing handler leaves `next_attempt_at` in the future, and an immediate second drain claims nothing.
  - The 5th failure sets `dead_at`.
  - Two events in one transaction are drained in `seq` order.

### S-13 · SHOULD · PDPA erasure completeness (candidate 10)

`erase_person` (current definition `003:111-165`) covers every `person` column added since 001, including `company_name_given`. These are the gaps:

| #   | Where                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | `integration_event.payload` keeps raw Stripe and WATI bodies (name, email, phone, WhatsApp text) with no person link. It also defeats the O2 fallback ("no bodies stored") if the WATI text sits there                                          | Retention, no DDL: a job sets `payload = '{}'` N days after `processed_at`. Or add `integration_event.person_id` and clear it in `erase_person`                                                             |
| b   | `task.title` is NOT NULL free text and isn't cleared (only `notes`, `003:157`)                                                                                                                                                                  | In `erase_person`: `UPDATE task SET title = initcap(replace(type,'_',' ')), notes = NULL WHERE person_id = ANY(v_ids) OR related_person_id = ANY(v_ids)`                                                    |
| c   | `match_payment` tasks hold raw Stripe details (§11.3) with `person_id` NULL, so erasure never reaches them                                                                                                                                      | With S-01: the match route sets `task.person_id`. `erase_person` also clears notes on tasks whose `payment_id` belongs to the person's enrolments or deals                                                  |
| d   | `payment.notes` (free text from the 9.12 modal) is kept. O12's fallback says erasure never touches payments                                                                                                                                     | Privacy-review decision only (Q7)                                                                                                                                                                           |
| e   | `touchpoint.landing_url` / `referrer` (O14, decide by **16 Oct**, the freeze day). The append-only trigger means any URL captured before the strip rule can never be cleaned. Erasure can't scrub one either                                    | If the O14 fallback (strip at capture) is adopted: no DDL, but it must be live before the first production or import touchpoint. If erasure must also scrub URLs: a second `forbid_change` exception in 007 |
| f   | `audit_log` (O13). `createPerson` writes the whole input (name, email, phone, notes) into `audit_log.after` (`lib/people/service.ts:348-360`). That contradicts the 002 comment that the audit row is unerasable and so stores no personal data | O13 fallback = accept. If redaction is chosen later, it is a `forbid_change` exception (function only). Either way, consider trimming what `createPerson` and PATCH audit                                   |

Affected: Shawn (`erase_person` 007, retention job). Zixuan only for c (the match route). Test: extend `002_merge_erase_tests.sql` to assert that `task.title` and the matched `match_payment` notes are cleared.

### S-14 · NICE · Rate limits (candidate 4)

No schema is needed if you take options 1 and 2.

1. **10/IP/min at the edge** (Vercel firewall, Cloudflare or DO load balancer). This is the right layer, because in-memory counters don't survive serverless or multi-instance hosting.
2. **3/phone/hour from existing data.** Count the `web_form`/`lead_form` touchpoints of the person whose `phone_e164` matches, over the last hour, using `touchpoint_person_time_idx`. This counts accepted submissions only, which is the intended meaning.
3. **Only if there's no edge limiter: a Postgres counter (007).**
   ```sql
   CREATE UNLOGGED TABLE rate_limit_hit (
     bucket        text NOT NULL,          -- 'ip:<addr>' or 'phone:<sha256(e164)>' -- never the raw phone
     window_start  timestamptz NOT NULL,
     hits          integer NOT NULL DEFAULT 1,
     PRIMARY KEY (bucket, window_start)
   );
   ```

Sign-in throttling (§14, 5 per 15 minutes) belongs to Supabase Auth, so no schema.

### S-15 · NICE · Indexes (candidate 5)

`pg_trgm` is created (`001:16`) and `person_name_trgm_idx` exists (`001:101`). But the search predicate ORs `full_name ILIKE` with `email_norm LIKE '%…%'` and a `regexp_replace(phone…)` substring (`lib/people/service.ts:76-81`). Postgres can only use a BitmapOr when every branch is indexable, so this query never uses the trigram index. At 13,000 rows a sequential scan is tens of milliseconds, inside §14's 500 ms. If you want the index to work, add trigram on `email_norm` and a generated `phone_digits` column with trigram.

Missing FK and lookup indexes. None of these changes the contract, and each matters only as volume grows:

```sql
CREATE INDEX person_created_idx      ON person (created_at DESC) WHERE deleted_at IS NULL AND merged_into_id IS NULL;  -- 9.1 default sort, created-between
CREATE INDEX person_merged_into_idx  ON person (merged_into_id) WHERE merged_into_id IS NOT NULL;                    -- merge/erase
CREATE INDEX person_wati_idx         ON person (wati_contact_id) WHERE wati_contact_id IS NOT NULL;                  -- WATI lookup
CREATE INDEX person_stripe_cust_idx  ON person (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;            -- Stripe lookup
CREATE INDEX company_membership_person_idx ON company_membership (person_id);                                        -- partial uq can't serve past memberships
CREATE INDEX deal_course_idx         ON deal (course_id) WHERE deleted_at IS NULL;                                   -- 9.5 course filter, "open deal for same course" (8.2 step 6)
CREATE INDEX deal_company_idx        ON deal (company_id) WHERE deleted_at IS NULL;                                  -- 9.4 detail, revenue
CREATE INDEX enrolment_deal_idx      ON enrolment (deal_id);                                                         -- deal detail, deal_has_payment
CREATE INDEX enrolment_booker_idx    ON enrolment (booker_person_id) WHERE booker_person_id IS NOT NULL;
CREATE INDEX task_deal_idx           ON task (deal_id);                                                              -- 9.6 tasks panel
CREATE INDEX task_enrolment_idx      ON task (enrolment_id);
CREATE INDEX enquiry_deal_idx        ON enquiry (deal_id);                                                           -- 9.6 linked enquiry
CREATE INDEX message_log_enquiry_idx ON message_log (enquiry_id);
```

Already fine: the 9.8 classes index (`class_public_schedule_idx`), the 9.13 queue (`enquiry_queue_idx`, `enquiry_assigned_idx`), the task queue `filter[mine]` (`task_open_by_assignee_idx`), the `last_activity_at` sort (`person_last_activity_idx`), tags, owner and needs_review.

### S-16 · NICE · Enquiry and WATI support (candidate 7)

- The 9.13 columns exist: `first_message_at`, `first_response_at`, `closed_at`, `assigned_user_id`, `status`. "Age" is computed. The SLA comes from `app_setting.first_response_sla_minutes` (seeded at 60). OK.
- `enquiry.wati_conversation_id` has no index, and nothing stops two concurrent inbound messages from opening two enquiries for one conversation. Option: `CREATE UNIQUE INDEX enquiry_open_conversation_uq ON enquiry (wati_conversation_id) WHERE status = 'open' AND wati_conversation_id IS NOT NULL;`
- `enquiry.channel` has no CHECK (`001:425`). Reports will group by it. Adding one is cheap: `CHECK (channel IN ('whatsapp','email','web_form','phone','walk_in'))`. Confirm the list (Q8).
- O4 says "SLA in business hours", but no business-hours or holiday setting exists. That is an `app_setting` row (data, not schema).
- The `message_log` columns cover §11. `status` is free text. That is OK given O2.

### S-17 · NICE · BI access (candidate 9)

§1 says the BI tool "reads the database directly". There is no read-only role and no reporting schema. A BI login using `DATABASE_URL` would see `audit_log`, `message_log` and unmasked contact details. Suggestion for S4, which needs grants and views rather than table changes:

```sql
CREATE SCHEMA reporting; CREATE ROLE bi_reader LOGIN; GRANT USAGE ON SCHEMA reporting TO bi_reader;
```

Put the views there with no contact columns (`payment_net`, funnel from `deal_stage_history` plus `deal.created_at`, attribution through S-08, enrolment history through S-04). Lost reasons are already right: group by `lost_reason.code` through `deal.lost_reason_id`, never through stage history (§12.5 v1.7). One gap: a deal's creation writes no `deal_stage_history` row, so the funnel's "entered new" comes from `deal.created_at`. Say so in the view.

### S-18 · NICE · Hygiene

- `005_row_version.sql` has no `BEGIN/COMMIT`. A failure partway through the loop leaves some tables versioned and others not. Wrap 006+ in a transaction, and confirm 005 applied cleanly wherever it ran.
- `needs_review_reason` holds one value. `createPerson` picks `phone_unnormalised` over a soft duplicate (`lib/people/service.ts:329-334`), so the duplicate signal is lost. That is acceptable for MVP; record it in §12.2.
- `audit_log.entity_id` is uuid, so a Settings change on `app_setting` (text key) can't be logged with an id, and the 9.16 "record" link has nothing to point at. Put the key in `after`, or add `entity_key text` later.
- PostgreSQL version: the README says 16 and the tests ran on 17.11. Production on Supabase is unconfirmed (Q2).

## 3. OK (checked, no change)

- **Tables.** The 23 in §5 match the 23 created in 001. §5 has no table the DDL lacks, and vice versa.
- **Enums.** Every enum in §5 matches its CHECK exactly, including `task_type` with `export_request`, `payment_status` with `partially_refunded`, and `touchpoint.channel` with `import`. String literals in `lib/`, `app/`, `tests/` and `seed-dev.ts` all fall inside the CHECKs.
- **§5 columns vs DDL.** All present. Extras are documented in the README: `deal.deleted_at`, `tag.is_active`, the `transferred` exclusion in the enrolment unique index.
- **Version and updated_at.** `version` and `bump_version` cover the 15 editable tables. `updated_at` triggers cover all 18 mutable tables. Append-only tables (`touchpoint`, `consent`, `deal_stage_history`, `audit_log`) have triggers instead. `person_tag` is a junction table with `tagged_at`.
- **Types.** Every timestamp is `timestamptz`. Dates use `date`. Money is `numeric(12,2)` with `_myr` names and `currency = 'MYR'`.
- **Soft delete.** `person`, `company` and `deal` have `deleted_at`. Classes are cancelled rather than deleted. Tasks and enquiries are closed, not deleted.
- **Uniqueness vs §5.** Email, phone, membership, course and class code, Stripe PI, message external id, `integration_event`, tag name (case-insensitive), `person_tag` PK, `lost_reason.code`, app_user email (case-insensitive), and one pending notice per class are all present. The extras are one first touch per person and one open HRDC task per deal.
- **FK `ON DELETE`.** Everything is NO ACTION, which fits soft-delete-only.
- **Stripe webhook replay (candidate 6).** `integration_event (source, external_event_id)` plus the partial unique on `stripe_payment_intent_id` make a replayed event a no-op. `match_status`/`unmatched` and the Stripe-only rule are in place. The gaps are in S-03 and S-01.
- **Expired reservations (candidate 11).** The sweep setting `status = 'cancelled', cancelled_reason = 'reservation_expired'` passes every CHECK. `reserved → cancelled` is a legal transition (§12.4). The partial unique index excludes `cancelled`, so re-booking works after the sweep. `merge_person`'s clash check excludes it too.

  The interplay that remains is code, not schema:
  - Until the sweep runs, `reserveSeat` returns `already_enrolled` for the expired row (`reserve.ts:64-68`, O22). Cancelling it in place under the class lock would remove that.
  - The sweep must lock the class row before the enrolments, in the same order as `reserveSeat`, to avoid deadlock. It must recompute `class.status`, because the public feed shows `full` until the sweep runs.
  - A Stripe payment arriving after the sweep can't revive a `cancelled` enrolment (only `cancelled → refunded` is legal). The webhook must create a new enrolment or go unmatched (O17).
  - An FPX payment still in progress should move the enrolment to `payment_pending` so the sweep skips it.

- **Import and last activity.** Nothing in the schema bumps `last_activity_at`. There's no trigger, as §12.9 requires.
- **Concurrency.** Two simultaneous public submissions for the same email: the second hits `person_email_norm_uq` and must retry as a match (code). `link_company_from_form` locks the person row, which serialises the §8.2 step 6 open-deal check if it runs afterwards.

## 4. Questions only Shawn can answer

| #   | Question                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Does the freeze cover indexes, and Shawn-only tables (`event_outbox`, `integration_event`, reporting views)? If not, say so in §5 and S-12, S-15 and S-17 can wait. If so, they go in 007/008 before 16 Oct. |
| Q2  | Have 001–005 been applied to the Supabase production database yet, and on which PostgreSQL version? That decides whether 006 has to backfill (S-03 `paid_at`, S-06 expiry) or applies to empty tables.       |
| Q3  | S-02: no-name WhatsApp people. Keep NOT NULL with the placeholder convention (recommended), or make `full_name` nullable?                                                                                    |
| Q4  | S-03: is one `refunded_at` (last refund) enough for Finance, or do multiple partial refunds need their own dates (a `payment_refund` table with `stripe_refund_id` unique)? Ties to O6 and O12.              |
| Q5  | S-05: are HRDC documents uploaded in MVP (add `deal.hrdc_document_key`), or should "HRDC documents" come out of §2 and §7?                                                                                   |
| Q6  | S-11: relax the `done_by` CHECK, or seed a "System" user for workers?                                                                                                                                        |
| Q7  | S-13 d/e/f: may `payment.notes` keep personal data after erasure? Is O14 decided as "strip at capture" by 16 Oct? Should `createPerson` and PATCH stop writing full contact details into `audit_log`?        |
| Q8  | S-16: the list of `enquiry.channel` values, and whether one open enquiry per WATI conversation is the rule.                                                                                                  |
| Q9  | S-04: full `enrolment_status_history` (recommended), or just `confirmed_at` / `cancelled_at`?                                                                                                                |
| Q10 | S-09: idempotency through `touchpoint.external_ref` (option A, no new table), or a dedicated `idempotency_key` table (option B)?                                                                             |
