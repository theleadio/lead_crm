# S1 Shawn-side work — design

Date: 7 Oct 2026 · Owner: Shawn · Path: architectural (new subsystems: event bus, seat reservation)

## Purpose

Build the part of Shawn's S1 slice (spec §15.4: "Outbox, Stripe gateway") that can be fully proven on a local Postgres today, using parallel subagents, on local branches, without changing Zixuan's code beyond what is listed here.

## Rule for this round

Only work that local Postgres can prove end to end is built. Work whose proof needs a system we cannot reach yet is parked, not built against a fake.

## In scope

### 1. Event contract (`feat/s1-events`, built first, everything imports it)

- `lib/events/types.ts` — one TypeScript union of the 13 event names in spec §11.1, each with a typed payload (§11.1: "Event names are exact"). `LeadCaptured`, `DealStageChanged`, `EnrolmentCreated`, `EnrolmentConfirmed`, `EnrolmentCancelled`, `EnrolmentTransferred`, `PaymentRecorded`, `ClassChanged`, `ClassNoticeApproved`, `ClassCancelled`, `ClassPublished`, `EnquiryConverted`, `ConsentChanged`.
- `lib/events/raise.ts` — `raiseEvent(type, aggregate, payload, actorId)`. Inserts into `event_outbox` through `db()`, so it joins the caller's open transaction (§3 "same transaction").
- `lib/deals/stage-service.ts`: the existing hand-written `event_outbox` insert becomes a `raiseEvent` call. Same row, same transaction. This and the Q1 edit below are the only edits to Zixuan's files.

### 2. Outbox drain (`feat/outbox-drain`)

- `drainOutbox({ batch })` in `lib/events/drain.ts`: claims unprocessed rows with `FOR UPDATE SKIP LOCKED`, looks up a handler by event type in `lib/events/handlers.ts` (empty registry), sets `processed_at` on success, or increments `attempts` and writes `last_error` on failure.
- An event type with no registered handler is marked processed (handlers arrive later with their rules; retrying forever helps no one).
- `scripts/drain-outbox.ts` runs one drain by hand. No HTTP route, no scheduler, no new env var.

### 3. Seat reservation (`feat/reserve-seat`)

- `reserveSeat({ personId, classId, dealId, actorId })` in `lib/enrolments/reserve.ts`, following spec §12.1 and §7 "Transactions": lock the class row, count seats with the existing `lib/classes/seats.ts` (reused, not re-implemented), read the reservation window from `app_setting` (48 h fallback), insert a `reserved` enrolment, recompute `class.status`, raise `EnrolmentCreated`, write an audit row.
- Returns result objects (`ok`, `no_seats`, `class_unavailable`), matching the `MoveResult` style in `stage-service.ts`.
- Kept although its first caller (checkout link) is parked: it is provable now, §8.3 and Zixuan's `POST /api/enrolments` need it, and its concurrency test is a go-live requirement (§14).

### 4. Q1 — TLS opt-out (done, commit `c173c3a`)

`lib/sql.ts` and `scripts/seed-dev.ts` hard-coded `ssl: "require"`. TLS is still required unless `DATABASE_URL` contains `sslmode=disable`. Production behaviour unchanged. Flagged for Zixuan's review.

### 5. Spec delta (docs only, `docs/s1-spec-delta`)

A proposed patch to `LEAD-CRM-Spec-v1.0.md` for Shawn to review, plus a short note for Zixuan (use `reserveSeat()` and `raiseEvent()`). Drafted, not sent.

## Parked (not built)

| Item                                              | Why                                                                                | Unparks when           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| Stripe webhook intake `POST /api/webhooks/stripe` | No Stripe account; a self-signed payload proves our code, not Stripe's real events | Stripe test keys exist |
| Checkout link `POST /api/deals/:id/checkout-link` | Creating a session is a Stripe call                                                | Stripe test keys exist |
| Outbox trigger (cron / process / pg-boss)         | Depends on what DigitalOcean hosts                                                 | DigitalOcean access    |
| Any deploy                                        | No access                                                                          | DigitalOcean access    |

Decisions recorded for the checkout link when it starts: it creates a `reserved` enrolment (same as §8.3); it charges the class price (`class.price_myr`, else `course.list_price_myr`) and only for individual, non-HRDC deals with a class; `deal.amount_myr` never reaches Stripe.

## Test environment

Local PostgreSQL 17.11. Databases `lead_test_a`, `lead_test_c`, `lead_test_int` (one per build agent so concurrent tests never collide), migrations 001–005 applied, SQL scripts 38/42/26/8/9 passing on each. Each has a stub empty `auth.users` table (the seed script reads Supabase's) and the dev seed applied (the suite expects it). `DATABASE_URL=…/<db>?sslmode=disable`.

Baseline on `main`: `npm test` 195 passed, 0 failed, on `lead_test_int`.

## Verification

- SQL scripts on each database: 38/42/26/8/9.
- `npm test` per branch on its own database, then on `feat/s1-integration`: baseline 195 still pass plus new tests.
- Outbox: two concurrent drains on two real connections never process the same row; a throwing handler leaves the row retryable with `last_error`; the drain script empties real `DealStageChanged` rows produced by a real stage move.
- Seats: two simultaneous reservations for the last seat on two real connections → exactly one succeeds; status flips to `few_seats`/`full` at the right counts; outbox and audit rows present.
- Not proven this round: a real Stripe session, a deploy, the outbox trigger. PostgreSQL 17 vs the 16 recorded in the schema README; production version unknown.

## Open items

| #   | Question                                                                          | Needed before        |
| --- | --------------------------------------------------------------------------------- | -------------------- |
| Q2  | Does creating a checkout link move the deal to `checkout_sent`? Spec is silent.   | Checkout link starts |
| Q3  | Checkout Sessions expire within 24 h; reservation default is 48 h. Which governs? | Checkout link starts |
| Q4  | Discounts through the link (deal amount ≠ class price). Proposed: not in MVP.     | Checkout link starts |

## Delivery

Local branches only, one worktree per track, nothing pushed. Wave 1: tracks 2, 3, 5 in parallel off `feat/s1-events`. Wave 2: merge into `feat/s1-integration`, run everything, one reviewer per diff, report.
