# Meta Lead Ads → CRM (draft)

**Date:** 4 Nov 2026 · **Status:** draft for team review · **Requested by:** Alicia · **Parent:** `2026-11-04-lead-sales-platform-design.md` §4

## 1. Goal

When someone fills in a Facebook or Instagram lead form, they should appear in the CRM within a minute: as a person, a touchpoint and a deal, the same way a website form lead does. Today they have to be copied by hand, or they arrive through SalesProcess.

## 2. What already exists

- **`captureLead()` in `lib/public/leads.ts`.** This is the website form's intake (spec §8.2). In one transaction it:
  - matches or creates the person, using `lib/people/dedupe.ts`
  - writes the touchpoint, the consent and the deal
  - raises `LeadCaptured`

  It accepts an `idempotencyKey`, so a repeat gives back the same result instead of a duplicate.
- **`leadSchema` in `lib/validation/public.ts`.**
  - Required: `fullName`, plus `email` or `phone`.
  - Optional: `companyName`, `jobTitle`, `preferredLanguage`, `courseInterest`, `classCode`, `message`, `consentMarketing`, `hrdcIntended`, and `attribution` (utm_*, fbclid, etc.).
- **`cleanUrl()`.** Spec O14 requires every intake path to use it on stored URLs.
- **The original spec already planned this** (§11.2): "n8n (Meta Lead Ads) → person, touchpoint, deal — same as form leads". Shawn owns it, and it isn't built yet.
- **Meta ad reporting** (`lib/ads/meta.ts`, migrations 013–015) already stores campaign and ad ids. A lead that carries its `ad_id` and `campaign_id` therefore links into the ROAS report.

## 3. Design

**Rule: reuse `captureLead()` and don't write a second intake.** Then Meta leads follow exactly the same dedupe, consent and deal rules as website leads (spec §5: "each rule lives in exactly one function").

How it works (how Meta delivers leads is from memory and **needs checking against Meta's current docs**):

1. **LEAD's Facebook Page subscribes our app to "leadgen" webhooks.** Meta then POSTs a small notice for each new lead, containing ids only (lead id, form id, page id, ad id). I understand the notice does not include the answers themselves.
2. **We fetch the answers.** Our endpoint verifies Meta's signature, stores the raw notice in `integration_event` (source `meta_leadgen`, unique by lead id, so a repeat is ignored) and returns quickly. A worker then calls the Graph API with the lead id to fetch the form answers.
3. **Map the answers to `leadSchema`:**

   | Meta form field | CRM field |
   |---|---|
   | full name (or first + last) | `fullName` |
   | email | `email` |
   | phone number | `phone` (normalised to E.164 by the existing code) |
   | company name, job title | `companyName`, `jobTitle` |
   | custom question "Which course?" | `courseInterest` |
   | custom question "Using HRDC?" | `hrdcIntended` |
   | consent checkbox (if the form has one) | `consentMarketing` |
   | form name | `formName` |
   | ad id, campaign id | `attribution` (utm_source `facebook` or `instagram`, `utm_campaign` = campaign id) |

   The custom questions depend on how marketing builds each form, so the mapping table is kept per form in Settings.
4. **Call `captureLead()`** with `idempotencyKey = "meta-leadgen:<leadId>"`. A replay or a Meta retry can then never create a second person or deal.
5. **On failure** (e.g. no email and no phone): mark `integration_event` failed, and create a task for marketing so no lead is lost.

## 4. Where it runs

| Option | For | Against |
|---|---|---|
| **A. Endpoint in `lead_crm`** | `captureLead()` lives there; one codebase owns person and deal rules | Adds a webhook to the CRM, which the user wanted to keep light |
| **B. Endpoint in `lead_sales`**, which calls the CRM's lead intake over HTTP | Keeps new work out of the CRM | Needs an internal authenticated call into the CRM |
| **C. n8n**, as the original spec planned | No code for the fetch step | Another system to run; the mapping logic lives outside git |

**Recommendation: B.** `lead_sales` receives the webhook and fetches the lead, then calls a new **internal** CRM endpoint that runs `captureLead()` behind a shared secret. Rules stay in one place and the CRM change stays small. This needs Shawn's agreement, because the spec gave this job to n8n.

## 5. Setup needed (checklist, to verify)

- A Meta app with webhooks for the Page.
- A Page access token with the permission to read leads. I believe this is `leads_retrieval`, and that it needs Meta's App Review. **Verify both.**
- The app secret, to check webhook signatures. Stored as an environment secret, never in git.
- A test lead form: Meta has a lead-ads testing tool, which can be used before going live.

## 6. Open questions

- Which lead forms are live today, and what custom questions do they ask? Alicia knows.
- Do the forms have a marketing-consent checkbox? If not, `consentMarketing` is false, and those leads get no marketing messages under the CRM's consent rules.
- Option A, B or C (§4)? Shawn and the team decide.
- Backfill: import past Meta leads, or only new ones from go-live? SalesProcess may already hold the old ones, and the GHL import (`lib/import/`) already pulls SalesProcess contacts.
