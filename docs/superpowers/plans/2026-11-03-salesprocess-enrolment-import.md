# SalesProcess → Enrolment Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paid SalesProcess orders become `confirmed` enrolments on the right CRM class (created if missing), and the LMS sync adopts those rows instead of duplicating them.

**Architecture:** Pure parsing/matching in `lib/import/` (unit-tested); one new script `scripts/import-salesprocess-enrolments.ts` that reads `salesprocess_payment`, fetches each order's line items from the SalesProcess API, and writes `class`/`enrolment` in one transaction; `scripts/sync-lms.ts` gains natural-key adoption of import-created rows and the start-date cut-over. Both scripts share an advisory lock.

**Tech Stack:** Node 24 (type stripping, `.ts` imports), `postgres` npm, `node:test` + `node:assert/strict`, `node:crypto` (SHA-1 for UUID v5, no new dependency).

**Spec:** `docs/superpowers/specs/2026-11-03-salesprocess-enrolment-import-design.md`

## Global Constraints

- No schema change, no migration file (schema frozen 16 Oct; Zixuan never edits migrations).
- No `payment` rows. No outbox events (`raiseEvent` is not called by either script).
- Never modify an enrolment or class the import did not create (import class = `notes` starts `Imported from SalesProcess.`; import enrolment = id equals `enrolmentIdFor(order_id)`).
- CI logs are public: print counts and product names only — never a buyer's name, email, phone or contact id.
- Dry run by default, `--apply` to write; one transaction; dry run rolls back (same `throw new Error("dry-run")` pattern as `sync-lms.ts`).
- Kuala Lumpur day for "today": `(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date` in SQL.
- New class defaults: capacity `40`, status `open`, venue `AI365 Hub`, address `TBC`, city parsed or `TBC`; online `online_url` `https://thelead.io`; notes `Imported from SalesProcess. Venue address and city still TBC.` (online: `Imported from SalesProcess.`).
- Cut-over cancel: `status` `cancelled`, `cancelled_reason` `Not in the LMS at class start`.
- Orders window: `paid_at` within the last 120 days; `live_mode` true; `order_id` not null.
- Tests: `node --test tests/<file>.test.ts`. DB tests cannot run against the dev DB (real data) — DB behaviour is proven by dry runs only.
- Commits: no Co-Authored-By / Generated-with lines (user rule).

## Review Focus

- A price text with no year whose date falls just after New Year (paid 28 Dec, "3 January") → must resolve to next year. Test in Task 1.
- Price and item name disagree (Vibe Coding "16 November" vs "23 Nov") → price wins. Test in Task 1.
- Two CRM classes of one course on the same start date with no language to break the tie → skip, never guess. Test in Task 2.
- An order with both a `succeeded` and a later `refunded` transaction → refunded. Test in Task 2.
- Re-running the import after an `--apply` → zero inserts (stable v5 ids). Checked in Task 3 Step 6.

---

### Task 1: Parse the class slot from order texts

**Files:**
- Create: `lib/import/class-slot.ts`
- Test: `tests/class-slot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ClassSlot = { start: string; end: string; language: "en" | "zh" | null; city: string | null };
  // texts in priority order: [price.name, item.name, product.description]; first text with a date wins
  // for date; language/city taken from the same text, else from later texts.
  export function parseClassSlot(texts: (string | null | undefined)[], paidAt: Date): ClassSlot | null;
  ```
  Dates are `YYYY-MM-DD`. HTML in descriptions: strip tags and decode `&amp;` before parsing.

- [ ] **Step 1: Write the failing tests** — one `test()` per row, `paid` = `new Date("2026-10-28T00:00:00Z")` unless stated:

  | texts[0] (price) | texts[1] (item) | expect start / end / language / city |
  |---|---|---|
  | `English Class - 11-12 November 2026 (Wed, Thurs) @ Oval Damansara` | – | 2026-11-11 / 2026-11-12 / en / null |
  | `Chinese Class - 14 & 15 November 2026 (Sat, Sun) @ AI365 Hub` | – | 2026-11-14 / 2026-11-15 / zh / null |
  | `17-18 October (English) @ AI365 Hub Oval Damansara` (paid 2026-10-10) | – | 2026-10-17 / 2026-10-18 / en / null |
  | `16 November (Mon) - English` | `AI Vibe Coding Mastery｜23 Nov (Mon) \| 9:00 AM` | 2026-11-16 / 2026-11-16 / en / null (price wins) |
  | `23 October 2026 (Fri) @ Johor Bahru` (paid 2026-10-20) | – | 2026-10-23 / 2026-10-23 / null / Johor Bahru |
  | `@ RM680` | `Claude AI 实战课 (中文) \| 28 November 2026 (Sat) \| 9:00 AM` | 2026-11-28 / 2026-11-28 / zh / null |
  | `@ RM228` | `AI Agents 线上实作课｜10月13日(二)｜8:00PM-10:00PM` (paid 2026-10-10) | 2026-10-13 / 2026-10-13 / zh / null |
  | `@ 228` | `AI Agents Online Workshop`, texts[2] `<p>Date: 20 Oct 2026</p>` (paid 2026-10-14) | 2026-10-20 / 2026-10-20 / null / null |
  | – | texts[2] `日期：2026年 11月 28号（六）` | 2026-11-28 / 2026-11-28 / zh / null |
  | `3 January (Sat) - English` (paid 2026-12-28) | – | 2027-01-03 / 2027-01-03 / en / null |
  | `@ RM680` | `Claude AI Mastery` | `null` (no date anywhere) |

- [ ] **Step 2: Run** `node --test tests/class-slot.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement `parseClassSlot`.** Month names full and 3-letter, English; Chinese `M月D日` / `YYYY年 M月 D号`. Range forms `D-D Month`, `D & D Month`, `D–D`. No year → the first date ≥ `paidAt − 7 days`. Language: `English` → en; `Chinese`, `中文`, `(Chinese)`, any CJK date form → zh; else null.
- [ ] **Step 4: Run** the test file — expect all PASS.
- [ ] **Step 5: Commit** `feat(import): parse class date and language from SalesProcess order text`.

### Task 2: Pure planning helpers for the import

**Files:**
- Create: `lib/import/salesprocess-enrolments.ts`
- Test: `tests/salesprocess-enrolments.test.ts`

**Interfaces:**
- Consumes: `ClassSlot` (Task 1).
- Produces:
  ```ts
  export const PRODUCT_COURSE: Record<string, string>; // salesprocess_payment.product → course.code, the 12 names in the spec §"Map product → course" (note the trailing space in "AI Vibe Coding 实战课 ")
  export const ONLINE_COURSES: ReadonlySet<string>;    // { "lms-ai-agents-online-workshop" }
  export const IMPORT_CLASS_NOTE = "Imported from SalesProcess.";
  export const SYNC_LOCK_KEY = 7_302_611;               // pg_advisory_xact_lock key shared with sync-lms.ts
  export function uuidV5(name: string): string;        // RFC 4122 v5, SHA-1, fixed namespace constant in this file
  export function classIdFor(courseCode: string, start: string, language: "en" | "zh"): string; // uuidV5(`sp-class|${courseCode}|${start}|${language}`)
  export function enrolmentIdFor(orderId: string): string; // uuidV5(`sp-enrolment|${orderId}`)
  export type Txn = { status: string; paid_at: Date; amount_myr: number; refunded_myr: number };
  export function orderState(txns: Txn[]): { state: "paid" | "refunded" | "ignore"; priceMyr: number };
  export type ClassCandidate = { id: string; language: "en" | "zh" };
  export function pickClass(candidates: ClassCandidate[], language: "en" | "zh" | null): string | "ambiguous" | null;
  export function classCodeFor(courseCode: string, start: string, language: "en" | "zh"): string; // `${courseCode minus "lms-"}-${start}-${language}`
  ```

- [ ] **Step 1: Write the failing tests:**
  - `uuidV5("sp-enrolment|abc")` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` and is equal on two calls; `enrolmentIdFor("a") !== enrolmentIdFor("b")`.
  - `orderState`: latest by `paid_at` decides — `[succeeded]` → paid, price = amount − refunded; `[succeeded, later refunded]` → refunded; `[partially_refunded 3200/200]` → paid, priceMyr 3000; `[failed]` → ignore; `[]` → ignore.
  - `pickClass([], "en")` → null; one candidate → its id regardless of language; two candidates en/zh with `"zh"` → zh id; two candidates with `null` → `"ambiguous"`; two `en` candidates with `"en"` → `"ambiguous"`.
  - `classCodeFor("lms-claude-ai-mastery", "2026-11-28", "zh")` → `"claude-ai-mastery-2026-11-28-zh"`.
  - `PRODUCT_COURSE["AI Vibe Coding 实战课 "]` → `"lms-ai-vibe-coding"`; `PRODUCT_COURSE["Unknown"]` → undefined.
- [ ] **Step 2: Run** `node --test tests/salesprocess-enrolments.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the exports above in `lib/import/salesprocess-enrolments.ts`. `uuidV5`: `createHash("sha1").update(nsBytes).update(name)`, take 16 bytes, set version nibble 5 and variant `10`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(import): product map, stable ids and order state for SalesProcess enrolments`.

### Task 3: The import script, API fetch, npm script and daily sync

**Files:**
- Modify: `lib/import/salesprocess-api.ts` (add `fetchOrder`)
- Create: `scripts/import-salesprocess-enrolments.ts`
- Modify: `package.json` (`"ghl:enrolments": "node --env-file=.env.local scripts/import-salesprocess-enrolments.ts"`)
- Modify: `.github/workflows/daily-sync.yml` (ghl job: `- run: node scripts/import-salesprocess-enrolments.ts --apply` after the payments step)

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: `export async function fetchOrder<T>(orderId: string): Promise<T>` — `GET ${BASE}/payments/orders/${orderId}?altId=${loc}&altType=location` via `getPage`.

- [ ] **Step 1: Add `fetchOrder`** beside `fetchTransactions`; update the header comment's "Used by" list.
- [ ] **Step 2: Write the script**, structure copied from `scripts/sync-salesprocess-payments.ts` (env check, `postgres(... max: 1)`, `sql.begin`, dry-run throw, `console.table(stats)`). Inside the transaction, in order:
  1. `SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`.
  2. Read `salesprocess_payment` rows per the Global Constraints window; group by `order_id`; `orderState`.
  3. Skip product not in `PRODUCT_COURSE` (count `skip: unknown product`, collect the product name for the dry-run list).
  4. Skip orders already settled, without fetching: state paid and an enrolment with id `enrolmentIdFor(order_id)` exists in any status (the LMS may have moved it on); state refunded and that enrolment exists but is not `confirmed`. (A refunded order with no import enrolment is still fetched, only so step 10 can report a seat held by another row; it never writes.)
  5. `fetchOrder`; texts = `[item.price?.name, item.name, item.product?.description]` of `items[0]`; `parseClassSlot(texts, paidAt)`; null → `skip: no date`.
  6. `end < KL today` → `skip: class ended`.
  7. Candidates: `SELECT id, language FROM class WHERE course_id = … AND start_date = … AND status <> 'cancelled'`; `pickClass`; `"ambiguous"` → `skip: ambiguous class`; null → insert class with `id = classIdFor(...)`, `code = classCodeFor(...)`, defaults from Global Constraints, `end_date` = slot end, `language` = slot language ?? `"en"`, `ON CONFLICT (id) DO NOTHING`.
  8. Buyer: `SELECT person_id FROM touchpoint WHERE external_ref = 'ghl:' || ${ghl_contact_id} LIMIT 1`; none → `skip: buyer not in CRM`.
  9. Paid: if an active enrolment exists for person + class → `already enrolled`; else `INSERT` (`id` = `enrolmentIdFor`, `confirmed`, `payer_type` `self`, `price_paid_myr`, `created_at` = first paid_at) inside `tx.savepoint`; on `no_seats` (SQLSTATE `P0001`, message contains `no_seats`) → `skip: class full`.
  10. Refunded: `UPDATE enrolment SET status = 'refunded' WHERE id = ${enrolmentIdFor(order_id)} AND status = 'confirmed'`. A refunded order whose buyer holds a non-import active enrolment on that class → count `refund held by another row` (list product + class code only).
- [ ] **Step 3: Type-check** `npx tsc --noEmit` — expect no new errors.
- [ ] **Step 4: Dry run** `npm run ghl:enrolments` — expect: counts printed, `DRY RUN`, inserts > 0 for the 11–12 Nov, 14–15 Nov and 16 Nov classes and a new Claude AI 28 Nov class; zero skips of `ambiguous class`. Paste the table into the PR description.
- [ ] **Step 5: Ask the user before `--apply`** (dev DB holds real data). After approval: `npm run ghl:enrolments -- --apply`.
- [ ] **Step 6: Re-run dry** — expect `insert` 0 for classes and enrolments.
- [ ] **Step 7: Commit** `feat(import): SalesProcess paid orders become enrolments`.

### Task 4: LMS sync adopts import rows and cuts over at class start

**Files:**
- Create: `lib/import/lms-adopt.ts`
- Test: `tests/lms-adopt.test.ts`
- Modify: `scripts/sync-lms.ts` (class block ~line 146–200, enrolment block ~line 254–301, transaction start)

**Interfaces:**
- Consumes: `IMPORT_CLASS_NOTE`, `SYNC_LOCK_KEY`, `pickClass` (Task 2).
- Produces:
  ```ts
  export type ImportClass = { id: string; course_id: string; start_date: string; language: "en" | "zh" };
  // cohort → CRM class id: own id if present in crmIds, else the single import class match, else cohort id.
  export function classIdForCohort(cohort: { id: string; course_id: string; start_date: string; language: "en" | "zh" },
    crmIds: Set<string>, importClasses: ImportClass[]): string;
  // import enrolments to cancel: active, in a class whose start_date <= todayKL, mapped to an LMS cohort this run, not matched this run.
  export function cutOverCancels(importEnrols: { id: string; class_id: string; status: string }[],
    lmsMappedClassIds: Set<string>, matchedIds: Set<string>, startedClassIds: Set<string>): string[];
  ```

- [ ] **Step 1: Write the failing tests:**
  - `classIdForCohort`: cohort id already in `crmIds` → cohort id; not in CRM, one import class same course + start → that id; two import classes en/zh, cohort zh → zh one; none → cohort id; import class of another course on that date → cohort id.
  - `cutOverCancels`: active import enrolment in a started, LMS-mapped class, unmatched → returned; same but matched → not; class not started → not; class not LMS-mapped → not; status `refunded` → not.
- [ ] **Step 2: Run** `node --test tests/lms-adopt.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `lib/import/lms-adopt.ts`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Wire into `sync-lms.ts`:**
  - First statement in `run`: `await tx\`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})\``.
  - Class block: load import classes (`notes LIKE ${IMPORT_CLASS_NOTE + "%"}`); compute `classOf = Map<cohortId, crmClassId>` with `classIdForCohort`; when it returns an import class id, write the class row under that id (`id: classOf.get(k.id)`) so the upsert updates it; its `notes` change to the LMS note. `existing`/`seen` lookups use the mapped id.
  - Enrolment block: `class_id = classOf.get(e.cohort_id)`. Load import enrolments: `SELECT id, person_id, class_id, status, price_paid_myr FROM enrolment WHERE id = ANY(ids)` where `ids` = `enrolmentIdFor(order_id)` for every distinct `order_id` in `salesprocess_payment`; key them `person|class`. Active import row → push an update with that row's `id`, LMS status, and its **existing** `price_paid_myr`; record in `matchedIds`. Refunded import row → skip, count `enrolment: refunded in SalesProcess`.
  - After the enrolment upsert: `cutOverCancels(...)`, then `UPDATE enrolment SET status='cancelled', cancelled_reason='Not in the LMS at class start' WHERE id = ANY(...)`; count `enrolment: cut over`. `startedClassIds` from `start_date <= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`.
  - Near-miss warning: import class and LMS cohort of the same course, start dates 1–7 days apart → `warnings.push` with both class codes.
- [ ] **Step 6: Type-check** `npx tsc --noEmit`.
- [ ] **Step 7: Dry run** `npm run lms:sync` — expect class `insert` 0 for cohorts whose class the import created, enrolment updates for buyers already in the LMS, no `person already enrolled` warnings for import rows, no errors.
- [ ] **Step 8: Full test run** `DATABASE_URL= npm test` — expect the new tests pass; `*-db` tests fail as before (dev DB rule), nothing else newly failing.
- [ ] **Step 9: Commit** `feat(lms-sync): adopt SalesProcess classes and seats, LMS owns them from class start`.
