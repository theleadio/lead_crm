# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences carry equal weight. Each surface serves one of them.

**LEAD staff using the CRM** (`app/(app)/(crm)`). Roles: super_admin, management, marketing, sales, support, operations, part_time (spec §6). They work at a desk, on a screen 1280px or wider, through a business day. Their jobs: follow up leads and enquiries, move deals through stages, fill classes, track enrolments and payments, and clear the "needs attention" queue on the home page. Each role sees only what it can act on.

**Public visitors** (`app/(public)`, `/schedule`, `/register/<classCode>`, `/enquiry`, in English and Chinese). Most arrive on a phone from Facebook or Instagram ads. Two kinds:

- working professionals in Malaysia who want practical AI skills and pay for themselves;
- employers and HR staff who send employees and fund them through HRDC.

Their job: find a class that fits (dates, language, venue, price, HRDC), then register and pay, or send an enquiry.

## Product Purpose

LEAD is an AI training academy in Malaysia ("Malaysia's Leading AI Training Academy", thelead.io). This repo is its CRM and the public pages that feed it.

The CRM is the system of record for people, companies, deals, classes, enrolments, enquiries and tasks. The public site has three jobs (spec §10): show the live schedule, capture leads with attribution intact, and hand paying visitors to Stripe without losing who they are.

Success: no lead lost between ad click and CRM record; staff act on the right record quickly; first-touch attribution survives so ad spend can be judged. First production release target: 14 Dec 2026.

## Positioning

Two claims lead, confirmed by the user on 2 Nov 2026:

1. **Hands-on, build real things.** Students leave with working AI systems, not slide decks (thelead.io copy). Programmes cover agentic automation, full-stack AI building, AI engineering and data science.
2. **HRDC-claimable for employers.** Flagship certifications are HRDC-registered, so a company's training levy can cover the fees. HRDC pricing and the HRDC registration path (enquiry and invoice, not card payment, spec §10.4) are first-class, not an afterthought.

Classes run in English and in Chinese. This is a product fact, not a lead claim.

## Operating Context

- Programmes (from `docs/superpowers/notes/2026-10-30-programme-price-list.md`): 2-day in-person certifications at AI365 Hub, Oval Damansara (MYR 3,200 self-funded, 3,500 HRDC, before 8% SST); 1-day Mastery workshops (680 / 880); 2-hour online Zoom workshops (228). Prices are read from the public pages and can change.
- Lead sources: Meta ads, the website, GoHighLevel imports, the LMS. Payments arrive from Stripe or the manual-payment endpoint only.
- All class times are Malaysian time.
- Ownership: Zixuan builds the CRM screens and public site; Shawn owns schema, migrations, integrations, webhooks and sync jobs. The spec `LEAD-CRM-Spec-v1.0.md` is the build reference.

## Capabilities and Constraints

- Stack: Next.js 16 (App Router, breaking changes from older versions), React 19, Tailwind, shadcn/Radix components, lucide-react icons, PostgreSQL.
- CRM is English only. Customer-facing pages exist in `en` and `zh` with separate root layouts; `<html lang>` is `en` or `zh-Hans`.
- Chinese copy uses the formal 您. HRDC wording such as "可申请 HRDC 津贴". A native speaker reads it before it goes public.
- Marketing-consent wording is fixed (spec §10.3): "Send me updates about LEAD courses by email and WhatsApp." No variants without PDPA sign-off.
- Never promise what the spec does not (for example a reply "within one working day") unless the business confirms it.
- Public site: mobile-first, usable from 360px, page weight under 1MB on landing pages, no layout shift when the schedule loads.
- CRM: usable from 1280px. Every list has filters, table, pagination (max 100 rows), loading skeleton, empty state with next action, error state with retry. Every destructive action confirms and names what it touches.
- Screens never invent a field the schema lacks (spec §1 rule 3).

## Brand Commitments

- **Follow the LEAD logo** (user, 2 Nov 2026). Source: thelead.io. Colour logo `https://thelead.io/wp-content/uploads/2019/06/logo-lead.png`; white logo `https://thelead.io/wp-content/uploads/2019/11/lead-white-logo.png`. Copied into `public/brand/` on 4 Nov 2026 (`lead-logo.webp` black wordmark, `lead-logo-white.webp` white wordmark, `lead-mark.png` disc alone). Brand blue #a1bace and yellow #fbe33b are sampled from it (user, 4 Nov 2026).
- Name: LEAD, all caps.
- No other binding brand rules (colours, fonts) were confirmed. Anything beyond the logo is open.

## Evidence on Hand

- Real programme names, prices and venues: the price-list note above.
- Live class data from `GET /api/public/schedule`.
- thelead.io states "15,000+ AI practitioners" in its community and shows student testimonials. Neither is in this repo. Reuse them only with the source; never invent testimonials, numbers, logos of client companies, or outcomes.

## Product Principles

1. **No lead lost.** Every path from ad to form to CRM keeps the person and their first touch. A failed submit keeps everything typed.
2. **HRDC is a main road.** Employers funding staff get the same clarity as self-funded buyers, on every price and every register step.
3. **Show the real class.** Dates, language, venue, seats and price come from live data, stated plainly. No hype the business cannot back.
4. **Staff act, not browse.** CRM screens put the next action first and show each role only what it can act on.
5. **Both languages are first-class.** A Chinese page is written for Chinese readers, not translated after the fact.

## Accessibility & Inclusion

WCAG 2.1 AA on the public site. CRM and public site: keyboard reachable, visible focus, labelled inputs, 4.5:1 contrast, dialogs trap focus and close on Escape (spec §14). Correct `lang` on every public page root.
