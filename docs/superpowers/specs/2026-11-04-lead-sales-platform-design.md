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
| SalesProcess modules to replace | Conversations inbox, Workflows/automation, Funnels/websites/forms, Email marketing, Social planner, Payments (v1 scope, decided 4 Nov). |
| "Track SSM" | The company's SSM (Suruhanjaya Syarikat Malaysia) registration number. |
| Corporate pipeline | engage → funding → submitted → approved, plus lost. |
| LMS | The CRM sends the LMS a signed notice (confirmed, cancelled, transferred). The LMS creates the account, emails a temporary password, and adds the student to the class. The LMS owns completion and certificates. Details in `2026-11-04-crm-to-lms-handoff.md`. |
| Ticket sources | WATI WhatsApp, Messenger (to confirm), a website help form open to anyone, and email. |

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
   - Logo colours, read from the logo file marketing sent on 4 Nov. The file is a compressed WebP, so these values can be a step off; confirm them against the original vector file.
     | Role | Hex |
     |---|---|
     | Logo blue | `#A1BACE` (a pale grey-blue, much lighter than today's `#4f6bed`) |
     | Logo yellow | `#FBE33B` (today's `--lead-yellow` is `#f5be2e`) |
     | Circle grey | `#3D3D3D` |
     | Wordmark | `#0A0A0A` on light backgrounds, white on dark |
   - Contrast (WCAG ratio; AA for normal text needs at least 4.5:1):
     - White text on logo blue: 2.01:1, fails AA.
     - White text on logo yellow: 1.30:1, fails AA.
     - Logo blue as text on white: 2.01:1, fails AA.
     - Dark `#0A0A0A` on logo blue: 9.83:1, passes. On logo yellow: 15.23:1, passes.
     - Logo blue on the dark theme's `#1B1D29`: 8.32:1, passes. Logo yellow on it: 12.88:1, passes.
   - Proposal: use the logo blue and yellow as **fills with dark text**, and for accents, badges and charts. Don't use them for white-text buttons or for text on white. For primary buttons and links on light backgrounds, use a darker blue built from the same hue. Its exact value is a design decision for marketing.
   - Zhixuan changes `app/globals.css` and `design.pen`, once marketing confirms the hex codes (decided 4 Nov).
5. **Dashboard.** Move the Upcoming classes panel (`app/(app)/(crm)/dashboard/classes-panel.tsx`) to the top of `dashboard/page.tsx`.
6. **Enrolment → LMS: send the sign-up data to the LMS** (decided 4 Nov).
   - Today: the CRM only reads the LMS (`lib/lms/read.ts`; separate Supabase project, the LMS owns its rows).
   - Plan: the CRM never writes into the LMS database. Outbox handlers in `lib/events/handlers.ts` POST a signed message to an endpoint in the LMS:
     - `enrolment.confirmed` → the LMS creates the student account (or finds the existing one) and enrols the student in the course/class
     - `enrolment.cancelled` and `enrolment.transferred` keep the LMS in step
     - The CRM's onboarding message gives the student the LMS link, `https://class.thelead.io/` (decided 4 Nov)
   - Completion and certificates are the LMS's (decided 4 Nov). The daily LMS sync copies `completed` and `certificate_no` back into the CRM.
   - Full contract: `2026-11-04-crm-to-lms-handoff.md`.
   - Signed with a shared secret (HMAC header), retried by the outbox, idempotent on the enrolment id.
   - Our team owns the LMS, so we also build the receiving endpoint, in the LMS repo. That repo is not attached to the session that wrote this spec; it has to be added before that work starts.
   - Still to agree: the LMS's full funding-type list, where the LMS endpoint lives, and the certificate template (LMS side).
   - Name stays **Enrolments** (decided 4 Nov; no rename to Onboarding).

## 4. New repo modules (phased)

| Phase | Module | Owner / requester | Notes |
|---|---|---|---|
| 1 | **Inbox and tickets** | — | WATI webhook, Messenger and email go into one conversations inbox. Any message, or a website help-form submission, can become a ticket. Rules route by category: **Finance** (e-invoice, receipt) or **Tech** (voucher, API key) get an owner. First reply due the next working day. Draft: `2026-11-04-inbox-tickets-design.md`. |
| 1 | **Meta Lead Ads intake** | Alicia | Webhook → the CRM's existing `captureLead()` → person, touchpoint, consent and deal, the same as a website lead. Draft: `2026-11-04-meta-lead-ads-intake.md`. |
| 2 | **Automation engine** | Alicia | Trigger → condition → action, driven from `event_outbox`. First flows: new lead gets a tag; enrolment confirmed sends the onboarding email and WhatsApp. Draft: `2026-11-04-automations-design.md`. |
| 2 | **Stripe payments** | JM | Stripe webhook records `payment` in the CRM first, then the LMS notice (3.6) goes out. The webhook belongs in `lead_crm`. Importing old Stripe data is open. Draft: `2026-11-04-stripe-payments-design.md`. |
| 3 | **Email marketing and social** | Wei Ping | Newsletters, tagging SOP, image library, scheduled posting to all social channels, and where a contact's email change is applied (single source of truth). |
| 3 | **Website and landing pages** | — | LEAD's own site. Brand: white, bright, Apple-like. Replaces SalesProcess funnels and forms, and hosts the help form that feeds tickets. |
| 4 | **AI support** | — | Answers common questions first, and hands off to a ticket when it can't. |

Tables the new repo would add, in its own `sales` schema (names provisional; see the build plan): `conversation`, `ticket`, `ticket_category`, `ticket_rule`, `team`, `team_member`, `holiday`, `automation`, `automation_step`, `automation_run`, `social_post`, `media_asset`. Where inbox messages are stored is an open conflict (§7.1). They need Shawn's review, like any change to the shared DB.

## 5. Open questions

| Question | Owner |
|---|---|
| Confirm logo hex codes against the original vector file, and choose the darker blue for buttons and links | Marketing |
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
- More drafts: `2026-11-04-meta-lead-ads-intake.md`, `2026-11-04-automations-design.md`, `2026-11-04-stripe-payments-design.md`, and the phased `2026-11-04-lead-sales-build-plan.md`.
- `lead_sales` is a full web app like SalesProcess, not a set of add-ons. Version 1 rebuilds Conversations, Automations, Funnels/Websites/Forms, Email marketing, Social planner and Payments. Contacts and opportunities stay in `lead_crm`; `lead_sales` uses them through the shared DB.
- Section 4 gets rewritten from a SalesProcess feature map, which is being researched separately.
- Enrolments keeps its name.
- New repo name: `theleadio/lead_sales`.
- LMS: the CRM sends sign-up data to an LMS endpoint our team builds (3.6).
- Read-only checks: `.github/workflows/data-check.yml`, started by hand, runs `scripts/check-stripe-summary.ts` and `scripts/check-salesprocess-channels.ts`. They print counts only, because Actions logs are public. They ship separately to `main` in PR #42 (they must be on the default branch to run).
- All `lead_sales` work goes to the `lead-sales/main` branch: one sub-branch and PR per module (e.g. `lead-sales/inbox`), so `main` stays untouched (decided 4 Nov). The Stripe webhook (PR #41) is a CRM fix and goes to `main`.

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

## 7. Review findings: gaps across the drafts (4 Nov)

A read-through of all the drafts found these. Each needs a decision before the module it touches is built.

All decided on 4 Nov unless marked otherwise.

| # | Gap | Decision |
|---|---|---|
| 7.1 | Where inbox messages are stored | `lead_sales`' own `sales.message` table. The CRM person timeline reads it through a view. |
| 7.2 | Email change (Wei Ping) | The CRM is the master. A change raises a new `PersonContactChanged` event, which sends `person.updated` to the LMS and updates the newsletter list. |
| 7.3 | Class changes don't reach the LMS | A 4th LMS notice, `class.updated`, sent on every `ClassChanged`. Cancellations were already covered by `EnrolmentCancelled`. |
| 7.4 | English and Chinese | Messages use the class language. Where there's no class (help-form replies, newsletters), they use the person's `preferred_language`. |
| 7.5 | Receipts and e-invoices | Stripe's automatic receipt emails are enough for now (a Stripe dashboard setting; no code). No e-invoice module yet. **Not confirmed:** whether LHDN MyInvois e-invoicing applies to LEAD, and from when. Finance should check before it becomes urgent. |
| 7.6 | Payments outside Stripe | No change needed. Manual HRDC, bank and invoice payments confirm the enrolment the same way, so the LMS notice and onboarding fire too. Ops should know that recording the payment is what starts onboarding. |
| 7.7 | Stripe webhook (go-live gate) | Built in PR #41 (to `main`), waiting for Shawn's review and the Stripe dashboard setup. |
| 7.8 | A safe place to build | A **separate Supabase project** as staging, with fake data, plus test WATI, Meta and Stripe accounts. Production is never used for development. |
| 7.9 | Who builds `lead_sales` | **Zhixuan and Shawn.** Per-phase owners are set in the build plan. |
| 7.10 | Inbox details | After-hours auto-reply: yes, once per conversation per evening, in the class language or else the person's. Overdue tickets: **dashboard only**, as a red overdue list, with no notifications. A customer reply on a resolved ticket **opens a new ticket** linked to the old one, which stays closed. Instagram DMs are included alongside Messenger. |
| 7.11 | Monitoring | WATI, Meta, the LMS notices and Stripe all report to the integration-health page the CRM spec already plans (§11.4). |
| 7.12 | Data protection (PDPA) | Conversations and attachments are **kept indefinitely and deleted on request**, the same as CRM people (export with `exportPersonData`, then erase). Onboarding messages are **service messages**: they go to paying students without marketing consent. Marketing consent applies only to promotions and newsletters. |

### More decisions, 4 Nov

- **Email service:** keep whatever SalesProcess uses today, for both newsletters and onboarding. Which service that is comes from the REA feature map.
- **Instagram DMs:** in the inbox, alongside Facebook Messenger.
- **Automations editors:** `management`, `super_admin` and `sales`. Marketing can't edit automations; Alicia's team asks one of them to change a flow.
- **LMS backfill:** when the CRM → LMS link goes live, a one-off backfill sends `enrolment.confirmed` for every confirmed enrolment in upcoming classes. It's idempotent on the enrolment id, so students already in the LMS aren't duplicated.
- **Branch sync:** whoever is building merges `main` into `lead-sales/main` every week.
