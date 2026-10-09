# Note for Zixuan: S1 Shawn-side changes (rewritten 9 Oct 2026 on top of spec v1.10)

Draft for Shawn to send. Spec is now v1.13 (v1.12 is upstream's decisions on O2, O11 and O13). Seats, class status and reservation expiry are the database's job (your migrations 006 and 007); nothing here changes them.

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
