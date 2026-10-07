# S1 Shawn-side work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event contract, the outbox drain and seat reservation, each proven on a local Postgres, and draft the matching spec delta.

**Architecture:** One shared contract (`lib/events/*`) that every writer of `event_outbox` goes through. `drainOutbox()` is a plain `/lib` function (no trigger, no route). `reserveSeat()` is the single §12.1 transaction (lock class row, count, insert, recompute status, raise event, audit). All SQL is parameterised `postgres` tagged templates through `db()`/`withTransaction()` from `lib/sql.ts`.

**Tech Stack:** Next.js 16 repo, TypeScript strict, `postgres` 3, `node:test` run as `npm test`, PostgreSQL 17 local.

**Spec:** `docs/superpowers/specs/2026-10-07-s1-shawn-side-design.md` (design) and `LEAD-CRM-Spec-v1.0.md` v1.7 (product spec: §3, §7, §11.1, §12.1, §14).

## Global Constraints

- Repo: `C:\Users\ShawnLiew\Desktop\lead_crm`. Local branches only. **Never `git push`.**
- Read `node_modules/next/dist/docs/` before touching anything Next-specific (`AGENTS.md`). This plan adds no Next routes or pages.
- Imports inside `lib/`, `scripts/`, `tests/` are relative with explicit `.ts` extensions (Node runs them directly; the `@/` alias does not resolve there).
- Layering (§3): no DB calls in React components; business rules live once in `/lib`.
- Event names are exact (§11.1): `LeadCaptured`, `DealStageChanged`, `EnrolmentCreated`, `EnrolmentConfirmed`, `EnrolmentCancelled`, `EnrolmentTransferred`, `PaymentRecorded`, `ClassChanged`, `ClassNoticeApproved`, `ClassCancelled`, `ClassPublished`, `EnquiryConverted`, `ConsentChanged`.
- Seat statuses and the "expired reservation frees its seat" rule come only from `seatTakenSql` / `SEAT_STATUSES` in `lib/classes/seats.ts`. Do not re-implement.
- Class status rule (§12.1): `seatsAvailable <= 0` → `full`; `<= few_seats_threshold` → `few_seats`; otherwise `open`. `draft`, `cancelled`, `completed` are never computed.
- Reservation window: `app_setting` key `reservation_expiry_hours` (jsonb number, seeded `48`); fall back to 48 when missing or `null`.
- Money, time, ids: UUID ids; `timestamptz` UTC; no floats for money (none used here).
- Every write that others react to also writes its `event_outbox` row in the same transaction (§3). Every create/update writes an `audit_log` row (§4) via `writeAudit` in `lib/audit.ts`.
- Never log personal data (§13).
- Prettier + ESLint must pass on changed files before each commit: `npx prettier --check <files>` and `npx eslint <files>`.
- Commit messages: imperative `type(scope): subject`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Test DBs (local PostgreSQL 17, migrations 001–005, dev seed, stub `auth.users`): `lead_test_a` (outbox track), `lead_test_c` (seat track), `lead_test_int` (integration). Each worktree has a gitignored `.env.local` holding its own `DATABASE_URL=…?sslmode=disable`. Run tests with `npm test` from the worktree root. Tests that need committed data (concurrency) clean up their own rows in `after`.

## Review Focus

Failure modes the spec implies but nothing in its text tests; each is pinned by a test in the task that owns it.

1. A handler that throws on one event must not stop the events behind it in the same batch (Task 2).
2. Draining an empty queue, or a batch size larger than the queue, returns zeros and does not error (Task 2).
3. An event row whose type has no handler is closed, not retried forever; a row that keeps failing stops being claimed after 5 attempts but stays visible with `last_error` (Task 2).
4. The same person reserving the same class twice gets a clean `already_enrolled`, never a second row or a raw unique-violation 500 (Task 4).
5. A reservation whose `seat_reserved_until` has passed does not hold a seat: the last seat can be reserved again (Task 4).
6. Cancelled, draft, completed or already-started class → `class_unavailable`; unknown class or person → `not_found`; none of these leave an enrolment, outbox or audit row (Task 4).

## Open items to confirm at plan review (the plan proceeds on the stated default unless Shawn says otherwise)

| #   | Choice the spec does not make                                                                             | Default used here                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q5  | `aggregate_type` for events other than `DealStageChanged` (which already writes `deal`)                   | `LeadCaptured`, `ConsentChanged` → `person`; `Enrolment*` → `enrolment`; `PaymentRecorded` → `payment`; `Class*`, `ClassNoticeApproved` → `class`; `EnquiryConverted` → `enquiry`. Held in one map in `types.ts`. |
| Q6  | `reserveSeat` rules: is `is_public` checked, what counts as "already started", when does status recompute | `is_public` not checked (public callers check it, §8.3); started = `start_date` earlier than today in Asia/Kuala_Lumpur; status recomputed only when current status is `open`, `few_seats` or `full`              |
| Q7  | Retry cap for a failing event (spec has `attempts`, no limit)                                             | Rows with `attempts >= 5` are no longer claimed                                                                                                                                                                   |

## Task Order and Branches

1. Task 1 on `feat/s1-events` (serial, main session). Worktrees for Tasks 2–4 and 5 branch from it after it is committed.
2. Tasks 2, 3→4, 5 in parallel, each in its own worktree under `C:\Users\ShawnLiew\Desktop\lead_crm-worktrees\<name>`: `outbox-drain` (`feat/outbox-drain`, `lead_test_a`), `reserve-seat` (`feat/reserve-seat`, `lead_test_c`, Task 3 then Task 4), `spec-delta` (`docs/s1-spec-delta`, no DB). Share `node_modules` with a directory junction (`mklink /J node_modules <main>\node_modules`).
3. Task 6 serial, main session.

---

### Task 1: Event contract

**Files:**

- Create: `lib/events/types.ts`, `lib/events/raise.ts`
- Modify: `lib/deals/stage-service.ts` (the `INSERT INTO event_outbox` block inside `moveDealStage`)
- Test: `tests/events.test.ts` (pure), `tests/events-db.test.ts`

**Interfaces:**

- Produces (`lib/events/types.ts`):
  - `EVENT_TYPES: readonly [...]` — the 13 names above; `type EventType = (typeof EVENT_TYPES)[number]`
  - `type EventPayloads` — map from each `EventType` to its payload, camelCase fields exactly as §11.1: `LeadCaptured {personId, dealId, formName, touchpointId}`; `DealStageChanged {dealId, fromStage, toStage, byUserId}`; `EnrolmentCreated {enrolmentId, personId, classId, status}`; `EnrolmentConfirmed {enrolmentId, personId, classId, language}`; `EnrolmentCancelled {enrolmentId, reason}`; `EnrolmentTransferred {enrolmentId, fromClassId, toClassId}`; `PaymentRecorded {paymentId, enrolmentId, method, amountMyr}`; `ClassChanged {classId, changedFields, noticeId}`; `ClassNoticeApproved {noticeId, classId}`; `ClassCancelled {classId, reason, enrolmentIds}`; `ClassPublished {classId}`; `EnquiryConverted {enquiryId, dealId}`; `ConsentChanged {personId, purpose, isGranted}`. String ids; `changedFields` is `Record<string, unknown>`; `enrolmentIds` is `string[]`; `amountMyr` is a string.
  - `EVENT_AGGREGATE: Record<EventType, string>` — per Q5 above.
- Produces (`lib/events/raise.ts`): `raiseEvent<T extends EventType>(type: T, aggregateId: string, payload: EventPayloads[T], actorId: string | null): Promise<void>` — inserts one `event_outbox` row (`type`, `aggregate_type` from `EVENT_AGGREGATE`, `aggregate_id`, `payload` via `sql.json`, `created_by` = actorId) through `db()`, so it joins an open transaction.

- [ ] **Step 1: Write the failing pure test** in `tests/events.test.ts`: `EVENT_TYPES` deep-equals the 13 names in the order of §11.1; `Object.keys(EVENT_AGGREGATE)` equals `EVENT_TYPES` (no event without an aggregate).
- [ ] **Step 2: Write the failing DB test** in `tests/events-db.test.ts` using the `it(name, fn)` + `rollbackAfter` helper copied from `tests/deals-db.test.ts`: (a) `raiseEvent("ClassPublished", classId, {classId}, adminId)` inserts exactly one row with `type='ClassPublished'`, `aggregate_type='class'`, `payload` equal to `{classId}`, `processed_at` null, `attempts` 0, `created_by` = admin; (b) with `actorId` `null`, `created_by` is null; (c) inside `rollbackAfter`, a `raiseEvent` followed by a thrown error leaves no row after the test (transaction join).
- [ ] **Step 3: Run** `npx node --env-file-if-exists=.env.local --test tests/events.test.ts tests/events-db.test.ts` — expect FAIL (module not found).
- [ ] **Step 4: Implement** `lib/events/types.ts` and `lib/events/raise.ts` to the interfaces above.
- [ ] **Step 5: Replace the `INSERT INTO event_outbox` block in `moveDealStage`** with `await raiseEvent("DealStageChanged", dealId, { dealId, fromStage: deal.stage, toStage, byUserId: viewer.id }, viewer.id)`; keep the §11.1 comment. Nothing else in that file changes.
- [ ] **Step 6: Run** `npm test` — expect all green: baseline 195 plus the new tests; `tests/deals-db.test.ts` (which asserts the `DealStageChanged` row's `type`, `aggregate_type`, `payload`) must still pass untouched.
- [ ] **Step 7: Commit** on `feat/s1-events`: `git add lib/events lib/deals/stage-service.ts tests/events.test.ts tests/events-db.test.ts` then `feat(events): typed event contract and raiseEvent`.

---

### Task 2: Outbox drain

**Files:**

- Create: `lib/events/drain.ts`, `lib/events/handlers.ts`, `scripts/drain-outbox.ts`
- Modify: `package.json` (one script: `"events:drain": "node --env-file=.env.local scripts/drain-outbox.ts"`)
- Test: `tests/outbox-db.test.ts`

**Interfaces:**

- Consumes (Task 1): `EventType`, `EventPayloads`.
- Produces (`lib/events/handlers.ts`): `type EventHandler = (event: { id: string; type: string; aggregateId: string; payload: unknown }) => Promise<void>`; `export const handlers: Partial<Record<EventType, EventHandler>> = {}` (empty this round).
- Produces (`lib/events/drain.ts`): `MAX_ATTEMPTS = 5`; `drainOutbox(opts?: { batch?: number; handlers?: Record<string, EventHandler> }): Promise<{ claimed: number; processed: number; failed: number }>` — `batch` default 20; `handlers` default is the registry above (override exists for tests).
- Produces (`scripts/drain-outbox.ts`): loops `drainOutbox()` until `claimed === 0`, prints the summed counts, calls `closeDb()`, exits non-zero if any row `failed`.

- [ ] **Step 1: Write failing tests** in `tests/outbox-db.test.ts`. Helpers: `insertEvents(n, type)` inserts n pending rows and returns ids. Tests (names are the contract):
  - `drain: processes pending rows, sets processed_at and attempts=1` (inside `rollbackAfter`; handler records ids; assert row `processed_at` not null, `attempts` 1, `last_error` null)
  - `drain: a throwing handler leaves its row pending with last_error and attempts=1, rows behind it still processed` (3 rows, handler throws for the first; assert second and third processed)
  - `drain: a failing handler's partial writes are rolled back` (handler inserts a `tag` row then throws; assert no such tag after drain)
  - `drain: a type with no handler is marked processed`
  - `drain: empty queue and batch larger than queue return zeros / no error`
  - `drain: rows with attempts >= 5 are not claimed` (insert with `attempts=5`; `claimed` is 0; row still `processed_at` null)
  - `drain: batch limits claims` (batch 2 of 5 → `claimed` 2, oldest first by `created_at`)
  - `drain: two concurrent drains never process the same row` — **not inside `rollbackAfter`**: commit 20 rows, run `Promise.all([drainOutbox({batch:10,handlers}), drainOutbox({batch:10,handlers})])` where the handler `await`s ~20 ms and records ids; assert every one of our 20 ids is recorded exactly once; delete our rows in `after`.
  - `drain: processes a real DealStageChanged row from a real stage move` (inside `rollbackAfter`: seed deal moved with `moveDealStage` as in `tests/deals-db.test.ts`, then `drainOutbox` with a recording handler for `DealStageChanged`; assert it received the payload `{dealId, fromStage, toStage, byUserId}`)
- [ ] **Step 2: Run** `node --env-file-if-exists=.env.local --test tests/outbox-db.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement `drainOutbox`** in `lib/events/drain.ts`. Approach: one `withTransaction` per call; claim with `SELECT … FROM event_outbox WHERE processed_at IS NULL AND attempts < ${MAX_ATTEMPTS} ORDER BY created_at LIMIT ${batch} FOR UPDATE SKIP LOCKED`; per row run the handler inside a savepoint (`(db() as postgres.TransactionSql).savepoint(...)`), so a failing handler's writes roll back; then `UPDATE` the row: success → `processed_at = now(), attempts = attempts + 1, last_error = NULL`; failure → `attempts = attempts + 1, last_error = <message truncated to 500 chars>`. Missing handler counts as success.
- [ ] **Step 4: Implement** `lib/events/handlers.ts`, `scripts/drain-outbox.ts`, and the `package.json` script.
- [ ] **Step 5: Run** `node --env-file-if-exists=.env.local --test tests/outbox-db.test.ts` — expect all pass; then `npm test` — expect baseline + Task 1 + new tests all green.
- [ ] **Step 6: Hand-run the script:** insert 3 pending `DealStageChanged` rows with `psql` into `lead_test_a`, run `npm run events:drain`; expected: prints `claimed 3 processed 3 failed 0`; `SELECT count(*) FROM event_outbox WHERE processed_at IS NULL` returns 0. Delete those rows afterwards.
- [ ] **Step 7: Commit** on `feat/outbox-drain`: `feat(events): drainOutbox with SKIP LOCKED claim, retry cap and runner script`.

---

### Task 3: Class status rule

**Files:**

- Create: `lib/classes/status.ts`
- Test: `tests/class-status.test.ts` (pure)

**Interfaces:**

- Produces: `type ClassStatus = "draft" | "open" | "few_seats" | "full" | "cancelled" | "completed"`; `computeClassStatus(current: ClassStatus, capacity: number, seatsTaken: number, fewSeatsThreshold: number): ClassStatus`.

- [ ] **Step 1: Write the failing test** with these cases (capacity 10, threshold 5): taken 0 → `open`; 4 → `open`; 5 → `few_seats` (available 5 = threshold); 9 → `few_seats`; 10 → `full`; 11 → `full`; `draft`/`cancelled`/`completed` at any taken value return unchanged; from `full` with taken 4 → `open`; threshold 0 and taken 9 → `open`, taken 10 → `full`.
- [ ] **Step 2: Run** `node --test tests/class-status.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `computeClassStatus` and `ClassStatus` in `lib/classes/status.ts` per the Global Constraints rule.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** on `feat/reserve-seat`: `feat(classes): computeClassStatus (spec 12.1)`.

---

### Task 4: Seat reservation

**Files:**

- Create: `lib/enrolments/reserve.ts`, `lib/people/activity.ts`
- Test: `tests/reserve-seat-db.test.ts`

**Interfaces:**

- Consumes: Task 1 `raiseEvent`; Task 3 `computeClassStatus`, `ClassStatus`; existing `seatTakenSql` (`lib/classes/seats.ts`), `writeAudit` (`lib/audit.ts`), `withTransaction`/`db` (`lib/sql.ts`), `isUuid` (`lib/people/service.ts`).
- Produces (`lib/people/activity.ts`): `touchPersonActivity(personId: string): Promise<void>` — `UPDATE person SET last_activity_at = now() WHERE id = $1` through `db()`. §12.9 and `lib/db/README.md` name this helper but it does not exist yet; this task creates it (flag to Zixuan in Task 5's note).
- Produces (`lib/enrolments/reserve.ts`):
  - `type ReserveInput = { personId: string; classId: string; dealId: string | null; actorId: string | null }`
  - `type ReserveResult = { kind: "ok"; enrolmentId: string; seatReservedUntil: Date; classStatus: ClassStatus } | { kind: "no_seats" } | { kind: "class_unavailable" } | { kind: "already_enrolled"; enrolmentId: string } | { kind: "not_found"; what: "person" | "class" | "deal" }`
  - `reserveSeat(input: ReserveInput): Promise<ReserveResult>`

Order inside the one transaction: validate uuids → lock class row `FOR UPDATE` (missing → `not_found`) → person exists and not deleted/merged/erased, deal (if given) exists → class unavailable if status not in `open`/`few_seats`/`full` or `start_date` before today in Asia/Kuala_Lumpur → existing active enrolment for (person, class) → `already_enrolled` → count taken seats with `seatTakenSql`; `capacity - taken <= 0` → `no_seats` → insert `reserved` enrolment (`seat_reserved_until = now() + hours`, `created_by` = actorId) → recompute and update `class.status` if changed → `touchPersonActivity` → `raiseEvent("EnrolmentCreated", enrolmentId, {enrolmentId, personId, classId, status: "reserved"}, actorId)` → `writeAudit` (`create`, entity `enrolment`, `after` = class/person/status/seat_reserved_until). Early returns write nothing.

- [ ] **Step 1: Write failing tests** in `tests/reserve-seat-db.test.ts`. Helper `newClass({capacity, threshold, status, startOffsetDays})` inserts a course + class (status default `open`); `newPerson()` inserts a unique person. Tests (names are the contract; all inside `rollbackAfter` except the race):
  - `reserve: inserts a reserved enrolment with seat_reserved_until ≈ now + 48h, outbox EnrolmentCreated, audit create, last_activity_at set`
  - `reserve: honours reservation_expiry_hours from app_setting` (set to 2; assert ≈ now + 2h)
  - `reserve: class status flips open → few_seats → full at the right counts` (capacity 3, threshold 1: after reservation 1 → `open`; 2 → `few_seats`; 3 → `full`)
  - `reserve: no_seats when full, writes no enrolment, outbox or audit row`
  - `reserve: an expired reservation does not hold a seat` (capacity 1; insert a `reserved` enrolment with `seat_reserved_until` in the past; a new person reserves successfully)
  - `reserve: already_enrolled for the same person and class, returns the existing id, no second row`
  - `reserve: a cancelled enrolment does not block re-booking`
  - `reserve: class_unavailable for draft, cancelled, completed and for a class that started yesterday`
  - `reserve: not_found for unknown class, unknown person, unknown dealId, malformed ids; nothing written`
  - `reserve: rolls back the enrolment when raiseEvent fails` (pass an `actorId` uuid that is not in `app_user`: the `created_by` foreign key fails, `reserveSeat` throws, and no enrolment row remains)
  - `reserve: last seat race — exactly one of two simultaneous reservations wins` — **committed data, two real pool connections**: capacity 1, two people, `Promise.all` of two `reserveSeat`; assert exactly one `ok` and one `no_seats`; exactly one enrolment row; class `full`; clean up all created rows in `after`.
- [ ] **Step 2: Run** `node --env-file-if-exists=.env.local --test tests/reserve-seat-db.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `lib/people/activity.ts` and `lib/enrolments/reserve.ts` to the order above.
- [ ] **Step 4: Run** the new test file — expect all pass; run it 5 times in a row (`for i in 1 2 3 4 5`) — the race test must pass every time.
- [ ] **Step 5: Run** `npm test` — expect baseline + new tests all green.
- [ ] **Step 6: Commit** on `feat/reserve-seat`: `feat(enrolments): reserveSeat with class-row lock (spec 12.1, 14)` plus the helper.

---

### Task 5: Spec delta (docs only)

**Files:**

- Modify: `LEAD-CRM-Spec-v1.0.md` (on branch `docs/s1-spec-delta`, off `feat/s1-events`)
- Create: `docs/superpowers/notes/2026-10-07-note-for-zixuan.md`

- [ ] **Step 1: Edit the spec**: changelog row `v1.8 | 7 Oct 2026 | S1 Shawn-side: event contract, outbox drain, seat reservation (§2, §3, §7, §12.1, §15.3)`; §2 "Jobs" row — the outbox drain is a plain function `drainOutbox()` in `lib/events/drain.ts`, trigger chosen when hosting is known; §3 — all outbox writes go through `raiseEvent()`; §7 `POST /api/deals/:id/checkout-link` notes — creates a `reserved` enrolment, charges class price (`class.price_myr`, else `course.list_price_myr`), individual non-HRDC deals with a class only, `deal.amount_myr` never reaches Stripe, **status: parked until Stripe test keys exist**; §12.1 — `computeClassStatus` and `reserveSeat` are the implementation; §15.3 — add rows Q2–Q7 from the design spec and this plan with decide-by dates left as `TBD by Shawn`.
- [ ] **Step 2: Write the note for Zixuan** (under 25 lines): use `reserveSeat()` from `POST /api/enrolments`; use `raiseEvent()` instead of hand-written outbox inserts; `computeClassStatus()` for 9.8–9.10; `touchPersonActivity()` now exists; `sslmode=disable` convention for local databases; the commit `c173c3a` touches `lib/sql.ts` and `scripts/seed-dev.ts`.
- [ ] **Step 3: Check** `git diff --stat` shows only these two files; `npx prettier --check` both.
- [ ] **Step 4: Commit**: `docs(spec): v1.8 S1 delta and note for Zixuan`. Do not send anything to anyone.

---

### Task 6: Integrate and verify

**Files:** none new.

- [ ] **Step 1:** In the main checkout, `git checkout -b feat/s1-integration feat/s1-events`; merge `feat/outbox-drain` and `feat/reserve-seat` (`git merge --no-ff`); expect no conflicts (disjoint files); resolve any in favour of keeping both sides.
- [ ] **Step 2:** On `lead_test_int` run the five SQL scripts with `PGCLIENTENCODING=UTF8 psql`; expect 38, 42, 26, 8, 9 passed, 0 failed.
- [ ] **Step 3:** `npm test` with `DATABASE_URL` for `lead_test_int` — expect baseline 195 plus every new test, 0 failed. Run twice (committed-data tests must clean up and be repeatable).
- [ ] **Step 4:** `npx tsc --noEmit` — compare with the pre-change run: the only errors allowed are the existing Next typegen ones (`RouteContext`, `LayoutProps`); nothing new. `npx eslint lib scripts tests` clean.
- [ ] **Step 5:** One reviewer subagent (`cavecrew-reviewer`) per branch diff against `feat/s1-events` (and one for the Task 1 diff against `main`): spec match, parameterised SQL only, outbox + audit rows present, no PII in logs. Fix confirmed findings on the owning branch, re-merge, re-run Steps 2–3.
- [ ] **Step 6:** Report to Shawn: branch list and commit ids, test totals with numbers, reviewer findings, what is unproven (real Stripe, DigitalOcean, trigger, PG16 vs 17). Nothing pushed.
