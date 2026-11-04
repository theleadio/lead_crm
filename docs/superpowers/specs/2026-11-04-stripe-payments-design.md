# Stripe payments: CRM first, then LMS (draft)

**Date:** 4 Nov 2026 · **Status:** draft for team review · **Requested by:** JM · **Parent:** `2026-11-04-lead-sales-platform-design.md` §4

## 1. Goal

JM's flow: **Stripe payment → recorded in the CRM first → then the LMS.** Nobody types a payment in by hand, and the student gets LMS access straight after paying.

## 2. What already exists

- **Checkout** (`lib/payments/checkout.ts`).
  - The CRM creates a Stripe Checkout Session in MYR.
  - The session carries `metadata[deal_id]`, `metadata[enrolment_id]`, `metadata[class_id]` and `client_reference_id = enrolment_id`.
  - The code comments say these names are "the contract with Shawn's webhook", and tests assert them.
- **`payment` table.**
  - `method`: `stripe_card`, `stripe_fpx`, `bank_transfer`, `hrdc` or `invoice`.
  - `status`: `pending`, `succeeded`, `failed`, `refunded` or `partially_refunded`.
  - Also `stripe_payment_intent_id`, `stripe_checkout_session_id`, `refunded_amount_myr`, and `match_status` (`matched` / `unmatched`).
- **The webhook is not built.** The original spec (§11.3) gives it to Shawn. The spec also says that until it exists, a paid enrolment stays `reserved` and **expires after 24 hours, freeing the seat although the student paid**. That is a go-live gate (spec §15.2).
- **Unmatched payments** (§11.3) are planned:
  - a `match_payment` task
  - a resolution screen
  - `POST /api/payments/:id/match`
- **`STRIPE_WEBHOOK_SECRET`** is already in `.env.example`.
- **`event_outbox`** has `PaymentRecorded`. `EnrolmentConfirmed` triggers the LMS notice (handoff doc).

## 3. Flow

1. **Stripe sends an event to the webhook.** These are the events I expect to need. **Check the names against Stripe's current docs:**
   - `checkout.session.completed`: card payments
   - `checkout.session.async_payment_succeeded` / `..._failed`: FPX and other delayed methods, where the money isn't confirmed at checkout
   - `charge.refunded`: refunds
2. **Verify it.** Check the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`. Store the raw event in `integration_event` (source `stripe`, unique by Stripe event id), so Stripe's retries are ignored. Answer `200` fast.
3. **Record the payment in the CRM**, in one transaction:
   - Find the enrolment from `metadata.enrolment_id`.
   - Insert or update `payment` (method, amount, status, Stripe ids, `paid_at`).
   - Move the enrolment from `reserved` / `payment_pending` to `confirmed`, through the existing status rules in `lib/enrolments/`, never by raw SQL.
   - Raise `PaymentRecorded`. The enrolment change raises `EnrolmentConfirmed`.
4. **Then the LMS.** `EnrolmentConfirmed` → the outbox sends the "enrolment confirmed" notice to the LMS (handoff doc) → the onboarding automation runs.

   That gives JM's order, **CRM first, then LMS**, and a failed LMS call can never lose the payment record.
5. **No match** (the enrolment is missing, or was cancelled after its reservation expired): store the payment as `unmatched`, and create the `match_payment` task (spec §11.3).
6. **Refund:** update `refunded_amount_myr` and status. A full refund moves the enrolment to `refunded`, which raises `EnrolmentCancelled`, and the LMS removes access.

## 4. Where it runs

The webhook writes CRM tables (`payment`, `enrolment`) and must follow CRM rules, so **it belongs in `lead_crm`**, e.g. `app/api/webhooks/stripe/route.ts`. That matches the original spec. The `lead_sales` "Payments" screens (transaction list, products, payment links) read these same tables.

## 4b. Receipts (decided 4 Nov)

Stripe's own automatic receipt emails are enough for now. That's a setting in the Stripe dashboard, with no code. There's no e-invoice module until Finance confirms whether LHDN MyInvois e-invoicing applies to LEAD (main spec §7.5).

## 5. Old Stripe data

The decision belongs to JM. Run the `data-check` workflow first (`scripts/check-stripe-summary.ts`). It shows counts and totals per year, so the size of an import is known. If it's imported, old charges match people by email. Anything that doesn't match is stored `unmatched`, so it isn't dropped.

## 6. Open questions

- ~~Who builds the webhook~~: built in PR #41, waiting for Shawn's review (decided 4 Nov).
- Payment links outside Checkout (e.g. invoices or links sent by sales): do they carry the same metadata? If not, they arrive unmatched.
- Partial payments / deposits: the spec mentions a part-payments question (O16). Does a deposit confirm the seat?
- Old Stripe data (§5): JM.
