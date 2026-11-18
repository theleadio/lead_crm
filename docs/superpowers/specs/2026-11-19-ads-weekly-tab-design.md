# /reports/ads: Weekly tab and where signups came from

Status: built on a draft PR, waiting for Shawn and Zhixuan to review before merge (19 Nov 2026).
Demo: [`2026-11-19-ads-weekly-tab-demo.html`](2026-11-19-ads-weekly-tab-demo.html). Open it in a browser. The page has no scripts and makes no network requests. Every number, class, campaign and name in it is made up; this repo is public.

## Why

Each week the owner wants three numbers:

1. How many people signed up (報名).
2. How many are pending.
3. How much was spent on ads.

The owner also wants to know where each signup came from: an opt-in or a lead, and which UTM.

The 18 Nov work already calculates the first three ([`weeklySummary`](../../../lib/reports/weekly.ts)). A review of the live page for 1 Oct–18 Nov found it still hard to use:

- **The page is too long.** It has 14 panels, including scatter charts, ROAS, 100+ rows of WhatsApp opt-ins, and campaign and source tables. The three numbers are buried at the top.
- **The cards show the wrong week.** They show the last week in the date range, which is usually a part-week. On a Wednesday, three days of signups set against "this point last week" with a big minus reads as a collapse, when the last complete week was normal.
- **Pending is 0 every week.** The definition stays as it is (`payment_pending`, or `reserved` with an unexpired hold; confirmed by the owner). The count is 0 because staff don't set those statuses. That is a process issue, not a code issue (see Ops follow-ups).
- **Cost per Meta signup reads high.** Only about a third of signups are matched to an ad, so spend is divided by too few signups.

## What changes

The report becomes two tabs on the same URL, using the existing `TabStrip` (as on Settings).

### Weekly tab (default)

URL: `/reports/ads`, optionally with `?week=YYYY-MM-DD`. Any day of the week works; it snaps to that Monday.

- **Which week:** with no `week` parameter, the last full Monday–Sunday week. Previous / next / "This week so far" links move between weeks. The current week ends today. A future or malformed week is refused with a message, not swapped for another week. Class size filter as before.
- **Four cards:**
  - Signups (with the Meta share).
  - Pending.
  - Ad spend.
  - Cost per Meta signup.

  A complete week is compared with the complete week before. The current week is compared with the same days of the week before. Ad spend now shows the previous week's spend too. When some signups aren't matched to an ad, a warning line says how many are matched, so cost per Meta signup isn't read as exact.

- **Signups by class, compact:** class, signups, HRDC, pending, spend, plus the "Ads not linked to a class" row and a total row.
- **Where signups came from:**
  - By source:
    - WhatsApp ad opt-in (`ctwa`)
    - Meta Lead Ads form
    - Website form
    - Link with UTM
    - WhatsApp direct
    - Referral
    - Walk-in
    - Said on the sheet
    - No source recorded

    Each source shows its count and share. "No source recorded" is shown in red.

  - By `utm_source` / `utm_campaign`: the top 10, then an "Other campaigns" row.
- **Each signup:** a list that starts closed. Columns are person (links to `/people/[id]`), class, source, utm_campaign and date.
- Only `weeklySummary` is read, so the tab doesn't wait on the other 12 queries.

### Ad details tab

URL: `?tab=details`. The report as it was, unchanged: date range, presets, by week, ad matching, ROAS, WhatsApp opt-ins and the rest. Its cards use the same new comparison wording.

## Attribution: last informative touch

A signup's source is the **latest touchpoint before the signup that says where the person came from**:

```
occurred_at <= signup time
AND (channel NOT IN ('import', 'payment_link')
     OR utm_source / utm_campaign / fbclid / ctwa_clid / gclid is set)
ORDER BY occurred_at DESC LIMIT 1
```

- The SalesProcess import and payment links leave bare rows with no tags. These are skipped, so they never hide an earlier known source. This answers the owner's question: "will it become empty?" No.
- Someone with no informative touch before the signup is "No source recorded". On live data that is currently most signups. This group shrinks only when ads carry UTM tags and the sheet's Source column is filled in.
- The Ad details tab still credits the **first** Meta touch (`AdMatch`, ROAS, per-ad tables), so its counts can differ from the Weekly tab. The Weekly tab says so.

## Code

| File                                                    | Change                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/reports/weekly.ts`                                 | `previousWindow()` (shared by the comparison and the new previous-spend query), `weekQuery()` and `weekAfter()`, `sourceBucket()`, the `LAST_TOUCH_SQL` lateral join on both signup queries (seats/orders and sheet), person name, and `bySource` / `campaigns` / `people` / `previous.spend` in the summary |
| `app/(app)/(crm)/reports/ads/page.tsx`                  | Tab split: a `WeeklyTab` branch with week navigation; Details is the existing body; shared `Header` and `SizeSelect`                                                                                                                                                                                         |
| `app/(app)/(crm)/reports/ads/panels/weekly-summary.tsx` | `WeeklyCards` week mode, comparison wording and previous spend, the match caveat, `SignupsByClass compact`, `SignupSources`, `SignupPeople`                                                                                                                                                                  |
| `tests/reports-weekly.test.ts`                          | `previousWindow`, `weekQuery`, `sourceBucket`, previous spend, source / campaign / people tallies                                                                                                                                                                                                            |
| `tests/reports-weekly-db.test.ts`                       | The last touch wins and bare import rows are skipped; a touch after the signup is ignored; an import-only person has no source                                                                                                                                                                               |

## Verification

- Done: unit tests (14 pass), `tsc --noEmit`, and eslint on the changed files.
- Not yet run: the DB test and a dev-server check. The only `DATABASE_URL` on hand is the Supabase pooler. Run both against a local database before merging:

  ```
  DATABASE_URL=<local> node --test tests/reports-weekly-db.test.ts
  ```

  Then run `npm run dev`, open `/reports/ads`, and check that the Weekly tab opens on the last full week and its signups and spend match that week's row in Ad details → By week.

## Ops follow-ups (not code)

1. When someone registers but hasn't paid, staff set the enrolment to `payment_pending` (or the checkout sets `reserved`). Until then, Pending stays 0.
2. Add the standard URL parameters to every Meta ad (see the 18 Nov proposal) so more signups are matched to an ad.
3. Fill in the participant sheet's Source column.

## Questions for Zhixuan

1. **Last touch vs first touch.** The Weekly tab uses last touch, as the owner asked. Ad details keeps first touch. Is it OK for the two tabs to differ (each says which rule it uses)?
2. **Names on the report.** The 18 Nov proposal said the report shows numbers only. The owner asked for a list of signups, so the Weekly tab names people and links to their pages. The page is gated like the person pages (person read; part-time assigned-only users are refused). Is that acceptable for PDPA, or should the list show only the class and source and link to the person?
