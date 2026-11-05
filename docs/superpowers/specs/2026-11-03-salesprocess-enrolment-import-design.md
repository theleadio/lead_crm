# SalesProcess → enrolment import — design

3 Nov 2026. Zixuan. Touches Shawn's lane (§11 sync jobs, `scripts/sync-lms.ts`): needs his sign-off before merge.

## Why

The Classes screen (§9.8) shows SEATS SOLD from CRM `enrolment` rows. Today only `scripts/sync-lms.ts` writes those, and only after Ops adds a buyer to the LMS. So an upcoming class reads 0/40 while SalesProcess already holds paid orders for it (on 3 Nov: Full-Stack 14–15 Nov 5 paid, Agentic Automation 11–12 Nov 2, Vibe Coding 12, Claude AI 28 Nov 23 with no CRM class at all).

Goal: a paid SalesProcess order shows as a taken seat on the right class by the next daily sync, without waiting for Ops.

## Goals

- Every live, paid SalesProcess order for a class that has not ended becomes a `confirmed` enrolment on the matching CRM class.
- When no CRM class matches the order's course and date, the import creates the class.
- A refunded order frees its seat.
- Ops keeps adding students to the LMS as today. When they do, the LMS sync updates the row the import made instead of adding a second one, and the same for classes.

## Non-goals

- No `payment` rows. Migration 016 explains why: SalesProcess sales have no deal, and the money already lives in `salesprocess_payment`.
- No history. Orders for classes that ended before the run are skipped; the LMS already holds those students.
- No screen changes. The Classes list and roster already count `enrolment`.
- No schema change (frozen 16 Oct).

## Anti-goals (failure even if it runs)

- A student counted twice on one class, or a class listed twice, once from each source.
- A seat for a test charge, a failed charge, or a fully refunded order.
- The import overwriting or cancelling an enrolment it did not create (LMS rows, staff enrolments, Stripe).
- A wrong-date class created from a stale funnel text, silently.

## Constraints found in the code and data

- `enrolment_person_class_active_uq`: one active enrolment per person + class.
- `class_code_key`: `class.code` is unique. The LMS sync sets `code` to the LMS slug.
- Seat triggers (006/007) own `class.status` and refuse an over-capacity seat with `no_seats` (P0001).
- `sync-lms.ts` keys classes and enrolments on LMS ids (CRM id = LMS id), creates in-person classes at AI365 Hub with address and city `TBC`, capacity 40, status `open`, and on an existing person+class enrolment warns and skips.
- `salesprocess_payment` (Shawn, 016) holds one row per transaction: `order_id`, `ghl_contact_id`, `status`, `amount_myr`, `refunded_myr`, `product` (= the funnel or payment-link name), `live_mode`, `paid_at`. It does **not** hold the class date.
- The class date is only on the SalesProcess order: `GET /payments/orders/{id}?altId={location}&altType=location` → `items[]`. Checked on 12 products, 3 Nov:
  - `items[].price.name` is the option the buyer picked and is the most reliable: `"English Class - 11-12 November 2026 (Wed, Thurs) @ Oval Damansara"`, `"Chinese Class - 14 & 15 November 2026 (Sat, Sun) @ AI365 Hub"`, `"17-18 October (English) @ AI365 Hub Oval Damansara"` (no year), `"16 November (Mon) - English"`, `"23 October 2026 (Fri) @ Johor Bahru"`.
  - For Claude AI Mastery and the online workshops the price is only `"@ RM680"` / `"@ 228"`; the date is in `items[].name` (`"Claude AI 实战课 (中文) | 28 November 2026 (Sat) | …"`, `"AI Agents 线上实作课｜10月13日(二)｜…"`) or `items[].product.description` (`"Date: 20 Oct 2026"`).
  - Item name and description are sometimes stale: Vibe Coding price says 16 November, item name says 23 Nov; a "[26-27 Sept]" payment link's description says 14–15 Nov.
  - The EN Full-Stack funnel sold a "Chinese Class" price: language comes from the price, not the funnel name.
  - LMS and SalesProcess can disagree on language (CRM Claude AI 1 Nov is `en`; SalesProcess sells Claude AI as 中文).

## Approaches considered

1. **Match on what the row is (chosen).** Both imports find a class by course + start date, and an enrolment by person + class, before creating. `sync-lms.ts` looks up by LMS id first, then by those keys, and updates the row it finds. No schema change. Weak spot: if Ops moves a cohort's date in the LMS after the import created the class, the keys stop matching and the class appears twice. The dry run lists near-misses (same course, start date within 7 days) so Ops can fix them.
2. **Link table LMS id ↔ CRM id.** Shawn adds a migration; a match is remembered, so later date changes follow it. Most robust, but a schema change after the freeze, blocked on Shawn's migration and spec edit.
3. Dropped: counting unmatched paid orders on the screen without writing enrolments. Breaks the rule that a screen's seat count equals `class_seats_taken()`, and cannot create classes.

Zixuan picked 1 on 3 Nov.

## Decided

- Source of truth for which class: the order's `items[].price.name`; fall back to `items[].name`, then `items[].product.description`, only when the price carries no date. (Proposed by Claude, accepted.)
- An order whose date matches no CRM class creates the class. (Zixuan.)
- Ops still adds every paid student to the LMS. (Zixuan.)
- Matching approach 1. (Zixuan.)
- SalesProcess is the truth until a class starts, the LMS from its start date. (Proposed by Claude, accepted by Zixuan; see "Payer vs attendee".)
- Claude's calls after the builder check, open to correction: adoption only of import-created rows; adopted rows keep the SalesProcess price; a SalesProcess refund wins over the LMS; no outbox events.

## The import: `scripts/import-salesprocess-enrolments.ts`

Dry run by default, `--apply` to write, one transaction, counts only in the log (repo is public), like the other sync scripts. `npm run ghl:enrolments`.

1. **Pick orders.** From `salesprocess_payment`: `live_mode`, `order_id IS NOT NULL`, `paid_at` in the last 120 days. Group by `order_id`; the order's state is its latest transaction (`succeeded` / `partially_refunded` = paid, `refunded` = refunded, anything else = ignore).
2. **Map product → course.** A constant in the script keyed by `salesprocess_payment.product`, value = `course.code`. An unknown product is skipped and counted, with its name in the dry-run output so the map can be extended. Initial map (3 Nov):
   - `.01 LEAD - AI Agentic Automation Certification Landing Page` → `lms-ai-agentic-automation-certification`
   - `.02 LEAD - EN - AI Full-Stack Building Certification Landing Page`, `.02 LEAD - CN - …`, `[26-27 Sept] AI Full-Stack Building Certification` → `lms-ai-full-stack-building-certification`
   - `.03 LEAD - Professional AI Engineering Certification` → `lms-professional-ai-engineering-certification`
   - `.05 LEAD - AI Agents Foundation Certification` → `lms-ai-agents-foundation`
   - `.05 LEAD - AI Agents Online Workshop`, `AI Agents Online Workshop`, `AI Agents 线上实作课` → `lms-ai-agents-online-workshop`
   - `[LIVE] Claude AI Mastery` → `lms-claude-ai-mastery`
   - `AI Vibe Coding 实战课 `, `AI Vibe Coding 实战课 - JB` → `lms-ai-vibe-coding`
3. **Fetch the order** from the SalesProcess API (new `fetchOrder(id)` in `lib/import/salesprocess-api.ts`, same 429 retry and pacing as the existing fetchers). Only orders not already settled are fetched: skip an order whose enrolment exists with the same paid/refunded state.
4. **Parse date and language** with a pure function `parseClassSlot(texts, paidAt)` in `lib/import/` (unit-tested on the strings above):
   - Date ranges `11-12 November 2026`, `14 & 15 November 2026`, `17-18 October`, single `16 November`, `28 Nov 2026`, Chinese `10月13日`, `2026年 11月 28号`.
   - No year: the first such date on or after `paidAt` minus 7 days.
   - Language: `English` → `en`; `Chinese`, `中文`, `(Chinese)` → `zh`; none → null.
   - City: `Johor Bahru` → `Johor Bahru`; otherwise unknown.
   - Mode: the online-workshop course → `online`; otherwise `in_person`.
   - No parsable date in any of the three texts → skip, count, list in dry run.
5. **Skip ended classes.** Parsed end date before today in Kuala Lumpur → skip (the LMS holds them).
6. **Find or create the class.** Candidates: CRM classes of that course with that start date, not `cancelled`. One candidate → it. Several → the one whose language matches; still several → skip and report. None → create:
   - `id` = UUID v5 of `sp-class|{course code}|{start date}|{language}` (stable across runs, so a re-run never creates it twice).
   - `code` = `{course code without "lms-"}-{start date}` plus `-{language}`; unique by construction.
   - In person: `venue_name` AI365 Hub, `venue_address` TBC, `city` parsed city or TBC. Online: `online_url` `https://thelead.io` (the LMS sync's fallback).
   - `capacity` 30 (the 4 Nov max of 30 seats per class), `status` `open`, `language` parsed or `en`, `notes` "Imported from SalesProcess. Venue address and city still TBC.", `price_myr` null.
7. **Find the buyer.** `person` via touchpoint `external_ref = 'ghl:' || ghl_contact_id`. None → skip and count (ghl:import runs first in the same job, so this is contacts newer than the last import).
8. **Write the enrolment.** `id` = UUID v5 of `sp-enrolment|{order_id}`.
   - Paid, no active enrolment for person + class → insert `confirmed`, `payer_type` `self`, `price_paid_myr` = amount − refunded, `created_at` = `paid_at`.
   - Paid, an active enrolment already exists (LMS, staff, or Stripe) → leave it, count `already enrolled`.
   - Refunded, and the enrolment is the import's own (id = the v5 id) and still `confirmed` → set `refunded`. Never touch any other row.
   - `no_seats` from the trigger → catch per row (savepoint), skip, report the class.
9. **Audit.** Not written: the LMS sync and ghl imports write none either. (Builder: check §12.11 / audit rules for scripts and follow them if they require it.)
10. **Events.** None, the same as the LMS sync (Claude's call). No `EnrolmentConfirmed`, so a future onboarding sequence does not message buyers about a class whose venue is still TBC; no `EnrolmentCancelled` on refund. Shawn must know imported rows raise no event when he builds onboarding (§11.1).

## The LMS sync change (`scripts/sync-lms.ts`)

Adoption covers **only rows the import created** (Claude's call): a class whose `notes` start "Imported from SalesProcess." and an enrolment whose id is the import's v5 id for its order. Classes staff made in the CRM, and Stripe or staff enrolments, are never adopted — adopting a staff class would rewrite `code`, which is in the public register URL.

- **Class.** For each LMS cohort: look up by id; if missing, look up an import-created class with the same course and start date (one candidate, language as tiebreak). Found → update that row (code, dates, language, status as today) and record `cohort id → CRM class id` in a map for the run. The row keeps its v5 id.
- **Enrolment.** Use the map for `class_id`. Before inserting by LMS id, look up an import-created enrolment for person + class:
  - active → update its status as the sync already does, but **keep `price_paid_myr`** (Claude's call: the LMS records no amount, `price_cents` is 0; the SalesProcess amount is the real one).
  - `refunded` → skip the LMS row and count it (Claude's call: a SalesProcess refund wins, so Ops not yet removing the student from the LMS does not bring the seat back).
- A refunded order whose seat is held by an LMS, staff or Stripe row is not changed; the import lists it for Ops.
- Because adoption re-runs every time (no stored link), an adopted row is matched again on every run. Approach 2 would remove that.
- **Near-miss report:** a LMS cohort and an import-created class of the same course whose start dates differ by 1–7 days → print both for Ops.

## Payer vs attendee (checked 3 Nov)

Paid live orders 20 Sep – 25 Oct for mapped products: 158. The buyer's CRM person is enrolled in the LMS on that course for 137 (87%); 14 (9%) are not (someone else attended, a different email in the LMS, or the buyer never came); 7 have no CRM person. No order is above RM 4,000, so no multi-seat orders were seen. Each one-qty order is one seat.

**Decided (Zixuan, 3 Nov): SalesProcess is the truth until the class starts, the LMS from the start date.** Before the start date a class may over-count by about one in ten, when the LMS lists someone other than the buyer. From the start date (Kuala Lumpur), the LMS sync cancels every import-created enrolment still active in a class it maps to an LMS cohort that it did not match on that run: `status` `cancelled`, `cancelled_reason` "Not in the LMS at class start". A class with no LMS cohort keeps its import seats; the LMS does not own it.

## Running it

- `daily-sync.yml`, `ghl` job: add `node scripts/import-salesprocess-enrolments.ts --apply` after `sync-salesprocess-payments.ts`.
- The `ghl` and `lms` jobs run in parallel. Both scripts take `pg_advisory_xact_lock(<shared constant>)` at the start of their transaction so the two never create the same class at the same moment. Manual runs get the same protection.

## Lifespan

A bridge until the CRM goes live (14 Dec 2026). After launch a buyer pays through the CRM's own checkout, which creates the enrolment in the CRM first; the CRM then pushes it to the LMS (that push is Shawn's §11 work, not built yet). From then on:

- The import only matters while SalesProcess funnels still sell. When they stop, remove its step from `daily-sync.yml`. Left on, it writes nothing once no new paid orders arrive.
- CRM checkout (Stripe) enrolments are never adopted or cancelled by either script, so the two models do not collide.
- The LMS sync's adoption stays useful only while Ops still creates cohorts in the LMS by hand.

Decided after the final review (3 Nov): the LMS takes over the day **after** a class starts (`start_date < KL today`), not on the start day — the 03:00 MYT cron runs before Ops adds same-day attendees.

## Tests

- `parseClassSlot`: every string quoted above, plus no-date, no-year near New Year, and conflicting price vs item name (price wins).
- Product map: unknown product skipped.
- DB-level: none can run against the dev DB (real data, 30 Oct). Prove with a dry run against the dev DB and compare counts with the 3 Nov numbers above.

## Left to the builder

- Exact regexes and the v5 namespace UUID.
- Whether a skipped order list in the dry run prints product names only (public CI logs must not print names, emails or phones of buyers).
- Merge order with Shawn: the `sync-lms.ts` change and the import should land together, or the LMS sync will warn and skip on the first student Ops adds.
