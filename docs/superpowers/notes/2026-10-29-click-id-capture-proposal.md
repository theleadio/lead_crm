# Change proposal: capture the other ad-click identifiers

Date: 29 Oct 2026 · From: Shawn (schema owner) · For: Zixuan (§10 capture code), privacy review (PDPA) · Status: **accepted and built, 29 Oct (spec v1.25, O61, migration 013)**

> **Update 29 Oct 2026.** Built as proposed, with these defaults for the open questions: Q1 all four columns; Q3 `firstTouch` unchanged; Q4 200-character caps for all four. Q2 (PDPA) is still with the privacy review. The parameter names and Google's 90-day window were still not checked against the live platform docs.

Touches §5 (`touchpoint`), §8.2 (`attribution` object), §10.2 and decision O14. Under §1 rule 1 the schema is frozen since 16 Oct, so this is written down as a request rather than a migration.

## 1. The ask

Add four nullable columns to `touchpoint` and capture them on the public pages exactly the way `gclid` and `fbclid` are captured today:

| Column      | Platform   | When the platform puts it in the click URL                                                  |
| ----------- | ---------- | ------------------------------------------------------------------------------------------- |
| `gbraid`    | Google Ads | Clicks from iOS apps, where Apple's ATT rules mean Google sends this **instead of** `gclid` |
| `wbraid`    | Google Ads | Clicks from iOS web traffic (same reason)                                                   |
| `li_fat_id` | LinkedIn   | When the Insight Tag's enhanced conversion tracking is on in Campaign Manager               |
| `ttclid`    | TikTok     | When auto-tagging is on for the TikTok ad account                                           |

Each platform's documentation is the authority on these parameter names and lengths. They were checked against general knowledge, not against the live docs, so confirm before building.

**Not asked:** spend sync, the `campaign` / `ad` / `ad_metric_daily` tables and the conversion uploads back to each platform. §5 defers those to January and this proposal doesn't change that.

## 2. Why now and not in January

The identifiers can't be backfilled. A lead captured today without its click identifier can never be matched back to the ad that brought it, so January's conversion upload would start with nothing to send for it.

- **Google** accepts offline conversions for clicks up to 90 days old (to verify against the current Google Ads API docs). Leads captured from mid-November onward are therefore still uploadable when the January work lands; leads captured before the change are not.
- **iOS visitors from Google ads arrive with no `gclid` at all**, only `gbraid` or `wbraid`. Today those leads look identical to organic traffic in the `touchpoint` row. The utm fields still say Google, but nothing ties the lead to a click.
- **Meta needs nothing new.** The `fbc` value Meta's Conversions API wants is built from `fbclid` and the click time (`fb.1.<ms>.<fbclid>`), and both are already stored. `_fbp` comes from Meta's own pixel cookie, which is marketing storage under §10.2 and stays out.

## 3. What changes, by file

### Shawn (schema, server)

1. **Migration `013_click_ids.sql`.**
   ```sql
   ALTER TABLE touchpoint
     ADD COLUMN IF NOT EXISTS gbraid    text,
     ADD COLUMN IF NOT EXISTS wbraid    text,
     ADD COLUMN IF NOT EXISTS li_fat_id text,
     ADD COLUMN IF NOT EXISTS ttclid    text;
   ```
   No backfill: there is no source for old values. No index: nothing looks a lead up by click identifier until January. `forbid_change()` (002) compares `to_jsonb(NEW) - person_id - is_first_touch`, so the new columns are append-only without touching the function (the same reasoning as `external_ref` in 009). Existing rows read as NULL, which is what they are.
2. **`lib/public/leads.ts`.** `cleanUrl()` keeps the four new parameter names. `captureLead()` writes them in the form-touch `INSERT`. The cookie first-touch `INSERT` stays as it is, because §8.2's `firstTouch` carries only the utm fields (see Q3).
3. **`lib/validation/public.ts`.** Add the four fields to `attributionSchema` as `text(200)`, matching `gclid`. 200 is a cap chosen for consistency, not a documented maximum; see Q4.
4. **Spec.** §5 `touchpoint` column list; §8.2 example body and the touchpoint bullet (the O14 rule now lists the new names); §10.2 list of captured parameters; O14 row amended; new open item O61 (below).

### Zixuan (§10 capture code)

5. **`app/(public)/attribution.ts`.** Add the four fields to `Touch`, `touchFrom()`, `parseTouch()`, `hasCampaign()` and `attributionPayload()`. Add the four names to the `trimUrl()` regex. It must stay identical to `cleanUrl()`, and the existing test that runs both over the same inputs enforces that.
6. **`tests/public-lead-form.test.ts`.** Extend the `touchFrom` and `trimUrl`/`cleanUrl` cases with one URL carrying all four parameters. Add a `hasCampaign` case for a URL carrying only `gbraid`, so an iOS Google click with no utm still counts as a campaign arrival and refreshes the last touch.

`attribution-script.tsx` needs no change: it only moves cookie text.

### Not affected

- `merge_person()` moves whole touchpoint rows. `erase_person()` keeps touchpoints. Neither lists columns, so neither changes.
- The person detail and timeline queries select named columns and don't show click identifiers. No screen change.
- The n8n Meta Lead Ads intake (not built) has no click URL to read. O14 already requires it to use `cleanUrl()` when it is built.

## 4. Cost

- One additive migration, no backfill and no lock beyond a metadata-only `ALTER TABLE` (nullable columns with no default).
- Roughly 40 changed lines across five files, plus tests.
- The attribution cookie grows by up to ~800 characters in the worst case, which is still well under the 4 KB per-cookie limit. Both cookies are rebuilt through `parseTouch()` caps, so an oversized or hostile value costs attribution, never the submission.

## 5. Questions to settle before building

- **Q1 (owner: Shawn + marketing).** Which platforms does LEAD actually buy ads on? Add only those columns. Google (`gbraid`, `wbraid`) is certain from the existing utm examples. LinkedIn fits the corporate and HRDC audience. TikTok should go in only if there is or will be TikTok spend. `msclkid` (Microsoft Ads) is the same shape if Bing is ever used.
- **Q2 (owner: privacy review).** Is this the same PDPA question already open on `gclid` and `fbclid`, or a new one? The `attribution.ts` header already says the ad network can tie these identifiers back to a person, and that calling the cookies functional is for the reviewer to confirm. The new identifiers behave the same way. Erasure keeps touchpoints (§12.10), so click identifiers survive an erasure today too. If the reviewer wants them cleared on erasure, that is an `erase_person()` change, and the append-only trigger would need the same kind of exception `merge_person()` has.
- **Q3 (owner: Shawn).** Should `firstTouch` in §8.2 carry click identifiers too? Today it carries only the utm fields, so a first touch from a Google ad stores `utm_source` but not its `gclid`. That gap already exists for `gclid` and `fbclid`. Fix it here for all six, or leave it as is?
- **Q4 (owner: Shawn).** Length caps. Use 200 for all four (the `gclid` cap), or 500 like `fbclid`? Check one real value from each platform before choosing.

## 6. Proposed spec entries

Open item, §15.3:

| #   | Question                                                                                                                             | Blocks                          | Needed by          | Owner                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------ | ---------------------- |
| O61 | Capture `gbraid`, `wbraid`, `li_fat_id`, `ttclid` alongside `gclid` / `fbclid` (proposal of 29 Oct)? Which platforms (Q1), PDPA (Q2) | §5 touchpoint, §8.2, §10.2, O14 | Before ads go live | Shawn + privacy review |

O14 row, if accepted: "keep only utm\_\*, gclid, fbclid, gbraid, wbraid, li_fat_id, ttclid and the path; …" with the rest of the decision unchanged.
