# Weekly signups, pending and ad spend on /reports/ads: proposal for review

Status: draft for review. Nothing is built yet.

## Why

Each week the business needs to know:

1. How many people signed up (by class, workshop or program).
2. How many signups are pending (signed up but not yet paid).
3. How much was spent on ads.
4. Which ad each student came from.

Today `/reports/ads` can't answer these:

- There is no total signup count, only a top list per campaign.
- Pending isn't shown.
- There is no weekly view.
- Signups that live only in the Google Sheet "LEAD Participant List 2026" aren't in the CRM at all.
- Many signups can't be matched to an ad.

## What is already working

- Meta ad spend syncs every day at 03:00 MYT through GitHub Actions (`.github/workflows/daily-sync.yml`). The last 7 runs all succeeded. Spend is stored in `meta_ad_insight`, one row per ad per day.
- SalesProcess contacts, attribution, payments and enrolments sync in the same job.
- Leads already carry ad data: `fbclid`, `ctwa_clid`, `utm_campaign_id`, `utm_ad_id`, `utm_content` (ad id) and `utm_term` (ad set id). `campaignIdSql` in `lib/reports/ads.ts` resolves a lead to its Meta campaign.
- `class_meta_campaign` links Meta campaigns to classes, which lets spend be split per class.

## Definitions

| Term        | Meaning                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup      | A person holding a seat in a class: an enrolment that is reserved, confirmed, onboarded, attended or completed. Also counts a paid SalesProcess order, or a row in the participant sheet. One person in one class counts once, however many systems record it. |
| Pending     | An enrolment with status `payment_pending`. It's shown separately and **not** counted in signups.                                                                                                                                                              |
| Meta signup | A signup whose person's first touch resolves to a Meta campaign.                                                                                                                                                                                               |
| Ad spend    | Meta spend from `meta_ad_insight`, scoped to `META_AD_ACCOUNT_ID`. Google Ads spend isn't included.                                                                                                                                                            |
| Week        | Monday to Sunday, Kuala Lumpur time.                                                                                                                                                                                                                           |

## The report (layout agreed with the owner on 18 Nov)

All text is in English, the same as the rest of the report.

1. **Range presets**: This week / Last week / Last 8 weeks. These only set the existing `filter[from]` and `filter[to]` values.
2. **Sync status line**: when the sheet was last synced, and the date Meta data is synced up to.
3. **Four cards**:
   - Signups, including how many came from Meta ads and what share that is
   - Pending
   - Ad spend
   - Cost per signup (spend divided by Meta signups)

   Each card also shows the change against the same point last week.

4. **Source chips**: how many signups are recorded in CRM/LMS, in SalesProcess, and in the sheet only.
5. **Signups by class**, one row per class, with these columns:
   - Type: Program or Workshop
   - Signups
   - HRDC
   - Meta
   - Pending
   - Spend
   - RM per signup
   - Top ad

   Two extra rows show sheet class names that don't match a CRM class, and ads not linked to any class, so the totals still add up.

6. **How signups were matched to ads**: three counts, for matched automatically, self-reported source, and not matched.
7. **Signups per ad**: ad, class, signups, spend and RM per signup. Ads that spent money but brought no signups are listed too.
8. **By week**: signups, Meta signups, matched %, pending, spend and RM per signup.
   - A week the range cuts short says so, for example "3 of 7 days".
   - Weeks before the sheet sync started are marked "approx.".
9. **Why signups don't match an ad**:
   - No source recorded
   - Has a source, but not Meta
   - Meta, but no campaign or ad id

The report shows numbers only. It doesn't list student names.

## Getting the participant sheet into the CRM

**The sheet today:**

- About 2,193 rows, one per person.
- Columns: Name, Company, Email, Mobile, HRDC, Classes Attended, Latest Class Date.
- "Classes Attended" is a comma-separated list such as `N8N: 11-12 Nov (HRDC)`.
- Ops add a row when someone signs up.
- The sheet has no signup date, payment status or source.

**Transport: the sheet pushes its data to the CRM.** This was chosen over a Google service account, so the sheet doesn't need to be shared with anyone new.

- An Apps Script inside the sheet runs every hour, using the sheet owner's own permission. It sends the rows in batches of 500 to a new CRM endpoint, `POST /api/sync/participants`.
- The endpoint checks a dedicated `X-Api-Key`, the same way `app/api/public/leads/route.ts` does. The key is stored in the script's Script Properties, never in the sheet itself.
- The logic lives in `lib/sync/participants.ts` so it can be tested without HTTP.

**Processing:**

- Each row is split into one pair per class: (person, class label).
- A row is matched to a CRM person by email, then by Malaysian phone number (spaces and dashes removed, leading 0 replaced with 60). If there's no match, a new person is created.
- A class label is mapped to a CRM class through a small mapping table. Labels that don't map are listed in the report so someone can map them.
- `(HRDC)` in a label marks the signup as HRDC-funded.
- The first time a (person, class) pair is seen counts as its signup date, so the date is accurate to within an hour.
- **First run (backfill):** older rows use the class date instead, and are flagged as approximate. Without this, week one would show a spike of about 2,000 signups.
- The sync only adds records. A row deleted from the sheet stays in the CRM, and the report shows how many signups come from the sheet so any drift is visible.
- Logs record counts only, because the repo is public.

## Which ad brought each student

Four methods are tried in order, and the first one that finds an answer wins.

1. **Automatic match (no extra work for ops).**
   - The sheet row's email or phone finds the CRM person, then that person's first Meta touch: a Lead Ads form, a click-to-WhatsApp ad (matched by phone through the WATI sync), or a web or SalesProcess form carrying UTM parameters.
   - Most students enquire through an ad before they sign up, so this also works for past signups.
2. **Ad URL parameters.** This is set once in Ads Manager and needs no code. Add this to every ad:
   ```
   utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
   ```
   The CRM already reads these fields. This only helps new leads.
3. **New "Source" column in the sheet.**
   - A dropdown: Facebook ad / WhatsApp ad / Referral / Returning student / Google / Other.
   - It covers walk-ins, referrals and phone signups.
   - It's shown as "self-reported" and isn't credited to a specific ad.
4. **Nothing found.** The signup goes into the "why signups don't match" section.

## Code changes

| Area                         | Files                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weekly summary query         | `lib/reports/ads.ts`, new `weeklySummary`. It reuses `seatTakenSql`, `firstCampaignSql`, `campaignMapSql`, `fillWeeks` and `daysInRange`.                                                   |
| Per-class and per-ad queries | `lib/reports/ads.ts`. Spend per class comes through `class_meta_campaign`.                                                                                                                  |
| Sheet sync                   | `lib/sync/participants.ts`, `app/api/sync/participants/route.ts`, `scripts/apps-script/participant-push.gs`, and a new migration for the label-to-class map and sheet participation tables. |
| UI                           | `app/(app)/(crm)/reports/ads/page.tsx` and new `panels/weekly-summary.tsx`. Each panel is wrapped so one failure doesn't take down the page.                                                |

## One-time setup (ops or owner)

1. Paste the Apps Script into the sheet, put the key in Script Properties, and run `install()` once to authorise it.
2. Add the "Source" dropdown column to the sheet.
3. Add the URL parameters to every active Meta ad.
4. Map any class labels the report lists as unmatched.

## Out of scope

- Google Ads spend.
- An automatic weekly WhatsApp or email summary.
- Meta Conversions API and offline conversions (planned for January in the spec, §5).

## Verification

- Unit tests for the week helpers. Database tests on local Postgres: one seat, one `payment_pending` enrolment, one SalesProcess order, one sheet row for the same person and class, and spend across two weeks. Assert the weekly counts, that pending isn't counted in signups, and that duplicates count once.
- Run a dev server and open `/reports/ads` with an 8-week range. Check weekly spend against Meta Ads Manager.
- Only read-only checks against production.

## Questions for the reviewer

1. Is "pending = `payment_pending`" the right definition, or should it also include checkouts sent but not paid?
2. Are the sheet class labels consistent enough to map, or should ops pick from a fixed class list?
3. Who maps new class labels, and who adds the URL parameters to ads?
