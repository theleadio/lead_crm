# Note for Zixuan: S1 Shawn-side changes (rewritten 9 Oct 2026 on top of spec v1.10)

Sent by Shawn to Zixuan on 13 Oct 2026; the content below is as of spec v1.17 (v1.12 was upstream's decisions on O2, O11 and O13). Changes since are at the end. Seats, class status and reservation expiry are the database's job (your migrations 006 and 007); nothing here changes them.

- **Events:** `raiseEvent(type, aggregateId, payload, actorId)` in `lib/events/raise.ts` writes an outbox row inside your open transaction. Types and payloads are in `lib/events/types.ts`. Your class and enrolment services insert the same columns by hand today; that works, converting is optional.
- **Enrolment status history (migration 009):** a database trigger writes `enrolment_status_history` on every insert and status change. Do not insert into it. Because of its foreign key, an enrolment can no longer be DELETEd once it exists: cancel it instead (tests that clean up with `DELETE FROM enrolment` need `tests/support/purge.ts`).
- **Class cancel:** `cancelClass()` now also writes `class.cancelled_reason` (one extra column in the UPDATE); the database stamps `cancelled_at`.
- **Payments (009):** a `succeeded`, `partially_refunded` or `refunded` payment needs `paid_at`; the status must agree with `refunded_amount_myr`; `refunded_at` is set exactly when something was refunded. Test fixtures that insert payments need those columns.
- **Tasks (009):** withdrawing a task sets `is_cancelled = true` together with `done_at` (the HRDC reminder code already does). A `match_payment` task needs `payment_id`. `done_by` may now be NULL on a closed task.
- **Outbox (010):** a failing event now backs off and is marked dead after 5 attempts; nothing for you to change.
- **Local databases:** put `sslmode=disable` in `DATABASE_URL` to turn TLS off for `lib/sql.ts` and `scripts/seed-dev.ts`.
- **Local seed:** the dev seed reads Supabase's `auth.users`, so a plain local Postgres needs an empty stub: schema `auth`, table `users(id uuid, email text)`.
- **Tests:** `npm test` runs with `--test-concurrency=1`, because the tests that commit data share the DB with row-counting tests.
- **Not built yet:** the drain has no scheduler, the Stripe webhook and checkout link are parked, nothing is deployed.

Added 13 Oct 2026 (spec v1.14, Shawn's answers on the rebase questions):

- **Your hand-written outbox inserts stay.** The eight `INSERT INTO event_outbox` statements in `lib/classes/service.ts`, `lib/enrolments/service.ts` and `lib/classes/notices.ts` are fine as they are; no need to convert them to `raiseEvent`.
- **Enrolment history `changed_by` stays NULL.** The database does not know who made the change; the `audit_log` row of the status move has the actor. Nothing to do on your side.
- **`class.cancelled_reason` is not enforced** by a CHECK. `cancelClass()` writes it, but a class cancelled in a test fixture without a reason is allowed.
- **Enrolments can no longer be DELETEd.** Anything that removes an enrolment (imports, admin tools, test cleanup) must cancel it instead, or use `tests/support/purge.ts` in tests.
- **One-line edit to your file:** `lib/classes/service.ts` now has `cancelled_reason = ${reason}` in the class UPDATE of `cancelClass()`, with a matching assertion in `tests/classes-cancel-db.test.ts`. Please keep it if you touch that function.

Added 13 Oct 2026 (spec v1.16, after the public API and the rebase onto your latest):

- **Three test fixtures got a `paid_at`.** Migration 009 refuses a `succeeded` payment with no `paid_at`. Three of your fixtures inserted exactly that, so I added `paid_at` to them and changed nothing else: the 008 SQL test (`lib/db/tests/008_payment_proof_unique_tests.sql`, six inserts), `tests/payments-manual-db.test.ts` and `tests/payments-proof-db.test.ts`. Your payment code already sets `paid_at`, so it needed no change.
- **One edit in your code: `raiseDuplicateTask` in `lib/people/duplicate-review.ts` now accepts a null actor.** The parameter is `Pick<Viewer, "id"> | null`; with null, `created_by` and the audit actor are NULL. Why: the public leads route has no signed-in user, and a soft match from the public form must raise the same duplicate task as `POST /api/people`, or the review queue shows a flag with no pair to open. Behaviour for signed-in callers is unchanged.
- **Public API (new, mine):** `GET /api/public/schedule` and `POST /api/public/leads` (spec §8.1, §8.2) in `lib/public/` and `app/api/public/`. `/register` is not built (no Stripe keys, O43). The leads route raises `LeadCaptured` and `ConsentChanged`.
- **Migrations 009 to 012 in one line each:** 009 is the pre-freeze schema (payment CHECKs and the `payment_net` view, `enrolment_status_history`, `class.cancelled_reason` and `cancelled_at`, task `payment_id` and `is_cancelled`, `touchpoint.external_ref`, `deal.source_touchpoint_id` and `hrdc_document_key`); 010 is outbox backoff, dead letters and `seq`; 011 is `task.source_key` (event handlers use it so a repeat run opens no second task); 012 is the rate-limit counter table for the public API. Full tables are in spec §5.
- **What to remember:** `cancelClass()` writes `class.cancelled_reason` (the database stamps `cancelled_at`); enrolments can no longer be DELETEd, cancel them instead; a database trigger writes `enrolment_status_history` on every insert and status change, so never insert into it yourself.

## Changes since this note (v1.17-v1.18), to forward

- **`RATE_LIMIT_SECRET` env variable (new, v1.17).** Server-only HMAC key for the per-IP rate limit on `POST /api/public/leads`; at least 16 characters; it must not be the public API key. Unset or short means that route answers 503. Needs setting on every environment you deploy (spec §2, O42).
- **Handler tasks are assigned to the duty super_admin (v1.17).** The tasks the outbox handlers create (type `other`, one per cancellation, "tell the student", "refund needed") now go to the longest-serving active super_admin, so Home's "my tasks" shows them. Decided 13 Oct: they stay that way, type `other`; revisit after go-live. No schema change (O37, spec §11.1).
- **Public form and consent (O45, decided 13 Oct).** A ticked marketing box never re-grants a purpose whose latest consent row is a withdrawal; the lead is still captured. Opt-in again only through Ops (a staff-recorded consent) or a future double opt-in, which is not built.
- **Idempotency key (O46, decided 13 Oct).** Accepted as is: the key is not tied to the submitter.
- **Supabase Data API (O47, decided 13 Oct).** Before go-live (Fri 27 Nov) the Data API is turned off for this schema and tested with the anon key. Nothing for you to build.
- **Decisions that need nothing from you:** O3 reservations staff make hold 48 hours (Stripe path stays 24 h); O9 corporate Booker model is built as in spec 12.2; O41 the form's `message` stays in `person.notes`; O14 URLs are cut to the path plus `utm_*`, `gclid`, `fbclid` on every capture path.
- **Hosting.** The outbox drain and the other workers will run as scheduled jobs on DigitalOcean; the drain is `npm run events:drain`. Where the database lives and what runs `expire_reservations()` every 15 minutes is still open (O48, Shawn, due Fri 16 Oct).
- **Duplicate review (your commit 1758c22).** The spec wording is drafted in v1.18 (7.1, 12.2 rule 3, the new 7 row for `POST /api/people/:id/review/dismiss`, and 6) and is with Shawn to proofread; it describes what you built and changes no behaviour.
