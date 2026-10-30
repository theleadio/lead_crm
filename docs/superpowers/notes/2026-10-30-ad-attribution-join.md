# Joining leads to Meta ad spend

Written 30 Oct 2026 for Zhixuan's "ad spend vs signups" chart. Numbers are from the Supabase CRM on 30 Oct, read-only.

## What is in the database now

- **`meta_ad_insight`**: one row per ad per day, 1 Jan to 30 Oct 2026. 13,771 rows, 251 campaigns, 2,478 ads, RM 352,248 spend, all MYR. Filled by `npm run ads:sync` (backfill: `-- --since 2026-01-01`). `url_tags` is set on 9,171 rows.
- **Attribution touchpoints**: 6,968 rows on 5,740 people, from the SalesProcess (GoHighLevel) import `npm run ghl:attribution`. They have `channel = 'import'`, `form_name = 'ghl-attribution'` and `external_ref` of `ghl-attr:first:<Contact Id>` or `ghl-attr:last:<Contact Id>`. `is_first_touch` is false on all of them.
- New `touchpoint` columns (migration 015): `utm_campaign_id` and `utm_ad_id`. Meta's own ids, so they join exactly to `meta_ad_insight.campaign_id` and `ad_id`.

## The join

A campaign id sits in `utm_campaign_id` on some rows. On others SalesProcess put the numeric id in the name field, so read it from either column:

```sql
SELECT t.person_id, t.external_ref, m.campaign_id
FROM touchpoint t
JOIN (SELECT DISTINCT campaign_id FROM meta_ad_insight) m
  ON m.campaign_id = COALESCE(
       t.utm_campaign_id,
       CASE WHEN t.utm_campaign ~ '^[0-9]+$' THEN t.utm_campaign END)
WHERE t.external_ref LIKE 'ghl-attr:%';
```

For ad level, join `t.utm_ad_id = meta_ad_insight.ad_id`. Rows that carry only a campaign name can be joined on `lower(btrim(campaign_name))`, which adds only 28 rows. Touchpoints cannot be updated, so the numeric ids stay in `utm_campaign`.

## How much joins

Of 5,935 attribution touchpoints that have a campaign value:

| Group                                                         | Rows  | Joins to spend             |
| ------------------------------------------------------------- | ----- | -------------------------- |
| Carry a campaign id                                           | 3,223 | yes, exactly               |
| Name field holds a numeric Meta campaign id                   | 1,903 | yes, as in the query above |
| Name matches a Meta campaign name (ignoring case and spacing) | 28    | yes                        |
| Anything else                                                 | 781   | no                         |

By person: 4,989 people have a campaign value and 4,457 (89%) of them join. All 3,241 rows with a campaign id and all 3,240 rows with an ad id match a spend row.

The 781 that do not join are not Meta campaigns: generic labels (`broad` 145 people, `jb` 66, `penang` 35, `em` 34, `engagement` 23, `video challenges` 108, `openclaw` 23, `cn direct ads` 22) and email sends (newsletters, "resend-unopened", live-correction emails). Nothing joins them to a Meta campaign.

## Limits to label on any chart

- **Dates are not touch dates.** The SalesProcess records carry no event date, so every attribution row is dated by the contact's `dateAdded`. Count signups by `person.created_at`, and use the touchpoint only for which campaign. Do not draw "touches per day" from it.
- **First vs latest.** 8,361 contacts have two records, and for 2,363 of them the campaign differs. Both are stored (`:first:` and `:last:`). Pick one rule for credit and say which. For 662 contacts only the latest record carries a campaign, and for 871 only the first does.
- **Spend starts on 1 Jan 2026.** A campaign that ran only before that has no spend rows.
- **Matching a campaign is not proof a person bought because of it.** It says which ad they came through, nothing about payment. Return on ad spend still needs real payments (the SalesProcess export had none), and prices on the programme pages are list prices, not amounts paid (see `2026-10-30-programme-price-list.md`).
- **`utm_source` keeps SalesProcess's value.** Meta placements appear as `facebook` (set when there is a click id, campaign id, ad id or a Facebook or Instagram medium), `fb`, `fb_ad`, `ig`, `an` and `th`. Treat a Facebook click id or a campaign id as the sign that a lead is from Meta, not the `utm_source` text.

## Not kept, on purpose

The SalesProcess records also hold an IP address, browser string, `_fbp`, `_fbc` and a Google client id. None of them were imported (spec §14 keeps IP addresses out, and §10.2 treats `_fbp` as marketing storage).

## Re-running

Both jobs are safe to repeat. `npm run ads:sync` refreshes the last 7 days by default. `npm run ghl:attribution` is a dry run unless `--apply --accept-approx-dates` is given, and skips anything already imported. New leads from SalesProcess need a fresh run of the import.
