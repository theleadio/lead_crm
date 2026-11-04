# LEAD sales platform: SalesProcess replacement brainstorm

**Date:** 4 Nov 2026 · **Status:** brainstorm output, for team review. Not approved for build.

## 1. Why

LEAD runs its sales process on SalesProcess. The `/v2/location/<id>/dashboard` URL looks like a white-labelled GoHighLevel, but this is unconfirmed. We want to own the sales process.

`lead_crm` already replaces the core of it:
- deals kanban
- people and companies
- classes and seats
- enrolments
- dashboard
- Stripe checkout
- LMS read
- SalesProcess import (`lib/import/`)

The team sent WIP feedback. Heavier new modules should not load the CRM's main line.

### Limits of this research

The Salesprocess dashboard could not be opened: the host was blocked in the research session, and the dashboard needs a login. The REA (reverse-engineering) skill was not available either. Everything here comes from the team's notes, answers in the brainstorm Q&A, and the `lead_crm` code. Someone with a login should check section 4 against the real SalesProcess screens before build.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where the work goes | Small changes go in `lead_crm` (section 3). New modules go in a **new repo, `lead_sales`** (section 4). |
| New repo stack | Same as `lead_crm`: Next.js 16, Supabase auth, raw SQL, Tailwind/shadcn, Netlify. |
| Data | The new repo **shares the CRM Supabase DB**: same `person`, `company`, `deal`, `enrolment` and `event_outbox`, plus its own new tables. |
| SalesProcess modules to replace | Conversations inbox, Workflows/automation, Funnels/websites/forms, Email marketing and social planner. |
| "Track SSM" | The company's SSM (Suruhanjaya Syarikat Malaysia) registration number. |
| Corporate pipeline | engage → funding → submitted → approved, plus lost. |
| LMS | The CRM writes to the LMS: it creates the student account, enrols the student in the course or class, and auto-issues the certificate. |
| Ticket sources | WATI WhatsApp, a website help form, and email. |

## 3. Changes to `lead_crm`

These are small. Every schema change goes through Shawn, because of the schema freeze in `lib/db/README.md`.

1. **Max 30 seats per class.**
   - Today: `class.capacity` only has `CHECK (capacity > 0)` (`lib/db/migrations/001_schema_v1.sql:236`).
   - Change: a new migration adds `capacity <= 30`, and `lib/validation/class.ts` gets the same max.
   - Before the migration runs, check that no existing class has capacity above 30.
   - Update spec §9.9.
2. **SSM number.**
   - `company.registration_no` already exists and is shown as "Registration no." (`company-form-dialog.tsx`, `lib/validation/company.ts`).
   - Proposal: relabel it "SSM no." and add format validation, instead of adding a new column. The team needs to confirm what "track" means: just storing it, or also checking it or making it required for corporate deals or HRDC.
3. **Corporate stages.**
   - Today: `new, discovery, proposal_sent, funding, won, lost` (CHECK in `001_schema_v1.sql:317`, and the discovery rule at line 322).
   - New: `engage, funding, submitted, approved, lost`.
   - Touches:
     - `lib/deals/stage-rules.ts`, `board.ts`, `stage-service.ts`
     - `hrdc-task.ts` (it uses the `won` timing)
     - `deals-board.tsx`
     - the corporate `won_at` logic
   - Needs a data migration for existing deals. The mapping is open (section 5).
4. **Brand colours.**
   - Today: `--lead-blue: #4f6bed` and `--lead-yellow: #f5be2e` in `app/globals.css`, with dark-mode variants at lines 93 and 206, and `design.pen`.
   - Change: switch to the exact logo blue and yellow. Hex codes are pending.
5. **Dashboard.** Move the Upcoming classes panel (`app/(app)/(crm)/dashboard/classes-panel.tsx`) to the top of `dashboard/page.tsx`.
6. **Enrolment → LMS: send the sign-up data to the LMS** (decided 4 Nov).
   - Today: the CRM only reads the LMS (`lib/lms/read.ts`; separate Supabase project, the LMS owns its rows).
   - Plan: the CRM never writes into the LMS database. Outbox handlers in `lib/events/handlers.ts` POST a signed message to an endpoint in the LMS:
     - `enrolment.confirmed` → the LMS creates the student account (or finds the existing one) and enrols the student in the course/class
     - `enrolment.completed` → the LMS issues the certificate and answers with its number, stored in `enrolment.certificate_no`
   - Signed with a shared secret (HMAC header), retried by the outbox, idempotent on the enrolment id.
   - Our team owns the LMS, so we also build the receiving endpoint, in the LMS repo. That repo is not attached to the session that wrote this spec; it has to be added before that work starts.
   - Still to agree: the exact fields, and the certificate template.
   - Name stays **Enrolments** (decided 4 Nov; no rename to Onboarding).

## 4. New repo modules (phased)

| Phase | Module | Owner / requester | Notes |
|---|---|---|---|
| 1 | **Inbox and tickets** | — | WATI webhook, Messenger and email go into one conversations inbox. Any message, or a website help-form submission, can become a ticket. Rules route by category: **Finance** (e-invoice, receipt) or **Tech** (voucher, API key) get an owner. Statuses and SLA to be decided. |
| 1 | **Meta Lead Ads intake** | Alicia | Webhook → `person` + `enquiry` in the shared DB, reusing the dedupe in `lib/people/`. |
| 2 | **Automation engine** | Alicia | Trigger → condition → action, driven from `event_outbox`. First flows: new lead gets a tag; enrolment confirmed sends the onboarding email and WhatsApp. |
| 2 | **Stripe payments** | JM | Stripe webhook records `payment` in the CRM first, then the LMS writer (3.6) runs. Importing old Stripe data is open. |
| 3 | **Email marketing and social** | Wei Ping | Newsletters, tagging SOP, image library, scheduled posting to all social channels, and where a contact's email change is applied (single source of truth). |
| 3 | **Website and landing pages** | — | LEAD's own site. Brand: white, bright, Apple-like. Replaces SalesProcess funnels and forms, and hosts the help form that feeds tickets. |
| 4 | **AI support** | — | Answers common questions first, and hands off to a ticket when it can't. |

Shared tables the new repo would add (names provisional): `conversation`, `message`, `ticket`, `ticket_rule`, `automation`, `automation_run`, `social_post`, `media_asset`. They need Shawn's review, like any change to the shared DB.

## 5. Open questions

| Question | Owner |
|---|---|
| Exact logo blue and yellow hex codes | Marketing |
| Mapping of old corporate stages to new ones (e.g. new/discovery→engage, proposal_sent→submitted, won→approved?) | Sales — asked 4 Nov, awaiting answer |
| What "track SSM" requires beyond storing the number (relabel, format check, required for corporate deals, e-invoice use) | Finance — asked 4 Nov, awaiting answer |
| LMS endpoint fields and certificate template (our team builds the receiver in the LMS repo) | Our team |
| Keep or import old Stripe data. Run `data-check` (stripe) for counts and totals per year first | JM |
| Messenger and email providers (inbound support inbox, newsletter ESP). Run `data-check` (salesprocess) to count conversations per channel first. Email-sending settings are likely not in that data and may still need someone with a SalesProcess login | Wei Ping / Alicia |
| Approval of shared-DB schema changes | Shawn |
| Who creates the new repo `theleadio/lead_sales` | Shawn / team |

### Decided 4 Nov
- Zhixuan handles 3.1 (30-seat cap) and 3.5 (dashboard order).
- Drafts: `2026-11-04-crm-to-lms-handoff.md` (message contract for 3.6) and `2026-11-04-inbox-tickets-design.md` (section 4, inbox and tickets).
- `lead_sales` is a full web app like SalesProcess, not a set of add-ons. Version 1 rebuilds Conversations, Automations, Funnels/Websites/Forms, Email marketing, Social planner and Payments. Contacts and opportunities stay in `lead_crm`; `lead_sales` uses them through the shared DB.
- Section 4 gets rewritten from a SalesProcess feature map, which is being researched separately.
- Enrolments keeps its name.
- New repo name: `theleadio/lead_sales`.
- LMS: the CRM sends sign-up data to an LMS endpoint our team builds (3.6).
- Read-only checks: `.github/workflows/data-check.yml`, started by hand, runs `scripts/check-stripe-summary.ts` and `scripts/check-salesprocess-channels.ts`. They print counts only, because Actions logs are public.

## 6. Team notes and where they went

| Note | Section |
|---|---|
| Max 30 seats | 3.1 |
| Track SSM; not blue, use logo blue and yellow | 3.2, 3.4 |
| Kanban corporate stages | 3.3 |
| Enrolments → LMS, auto-certificate, rename to onboarding | 3.6 |
| Upcoming classes to the top of the dashboard | 3.5 |
| WATI, Messenger | 4 (inbox) |
| Own website, landing page, Apple-style brand | 4 (website) |
| Own sales process, AI support | 4 (automation, AI support) |
| Tickets sorted to Finance or Tech | 4 (inbox and tickets) |
| Wei Ping: payment, newsletter, tagging SOP, images, posting, email change | 4 (email and social, Stripe) |
| Alicia: Meta Lead Ads → CRM, automation, social posting, onboarding email | 4 (lead intake, automation) |
| JM: Stripe → CRM → LMS, old Stripe data | 4 (Stripe), 5 |
