# Why signups have no source, and what changed (19 Nov)

Read from code and schema only; no production query was run. Counts per cause are therefore not known: `npm run signups:source -- --from <date> --to <date>` prints them (read-only unless `--apply`).

## How the Weekly tab decides "No source recorded"

`LAST_TOUCH_SQL` (lib/reports/weekly.ts) takes the latest touchpoint at or before the signup time. `import` and `payment_link` rows only count if they carry a UTM or click id. So a signup lands in "none" when it has no touchpoint, only bare import rows, or its informative touchpoint is dated after the signup.

## Where a touchpoint is written, and what each entry point keeps

| Entry point                                                                                   | Channel                            | Keeps                                                                 | Drops                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/enquiry` and `/register` forms, `POST /api/public/leads`, `/register` (lib/public/leads.ts) | `web_form`                         | all utm_*, utm_id, utm_ad_id, click ids, landing, referrer, form name | **From the web cookie:** `utm_id` and `utm_ad_id` were never read, and the first-touch cookie kept only source, medium and campaign (no ad id in `utm_content`, no ad set in `utm_term`, no `fbclid`, no landing page)       |
| WATI webhook (lib/wati/webhook.ts)                                                            | `ctwa` (with referral), `whatsapp` | ad id, click id, ad URL                                               | **A `whatsapp` touch was written only for a person the message created.** Someone already in the CRM from an import or the sheet got none                                                                                    |
| WATI CTWA sync (lib/import/wati-ctwa.ts)                                                      | `ctwa`                             | ad id, click id, source `facebook`                                    | nothing relevant                                                                                                                                                                                                             |
| Participant sheet sync (lib/sync/participants.ts)                                             | `import`, source `self:<Source>`   | the Source column                                                     | **A Source typed after the person's first sync was dropped** (one touch per person, first one wins, and the first had none). **When it was kept, it was dated at sync time, after the signup, so the Weekly tab skipped it** |
| GHL contacts / opportunities / forms imports                                                  | `import`                           | form name only                                                        | all UTM and click ids (by design: they are bare rows)                                                                                                                                                                        |
| GHL attribution import                                                                        | `import`                           | utm_*, campaign id, ad id, fbclid                                     | n/a (the only SalesProcess path with tags, and only for contacts that had attribution)                                                                                                                                       |
| Stripe webhook, manual payments, staff-created people and enrolments                          | none                               | nothing                                                               | no touchpoint is written at all                                                                                                                                                                                              |

`utm_source` was stored as typed (`fb_ad`, `fb`, `ig`, `facebook`); reports fold these when reading, other readers do not.

## Causes, in the order they probably matter

1. **Imported and SalesProcess people with only a bare `import` row.** The GHL contact, opportunity and form imports write rows with no tags. Unless the attribution import also found a record for that contact, nothing says where they came from. Not fixable in code; needs Ops to say how they came (sheet Source column) and the ads to carry the parameters.
2. **People who messaged on WhatsApp directly after being imported.** Fixed: the first inbound message now records a `whatsapp` touch when the person has no informative touch.
3. **Source typed in the sheet later.** Fixed: recorded once, dated at the person's earliest sheet row. `npm run signups:source -- --apply` heals old rows.
4. **Ad links without tags, or tags lost on the way.** Web cookie now keeps `utm_id`, `utm_ad_id`, and the whole first touch. A link with `fbclid` but no `utm_source` now stores source `facebook`.
5. **Staff-made enrolments, walk-ins, returning students.** No touchpoint exists. Not fixed in code (a staff form for "how did they hear" is a product decision).
6. **Pages outside this app** (the `ai.thelead.io` lead_sales pages post to `/api/public/leads` with their own attribution). Whether they forward UTMs was not checked: the code is not in this repo.

Checkout: `/register/<class>` submits through the same lead capture, so the touch is written when the person registers and the seat is held. No new touch is needed at payment time.

## What changed

- Web cookie and payload: `utm_id`, `utm_ad_id`, full first touch (`app/(public)/attribution.ts`, `lib/validation/public.ts`, `lib/public/leads.ts`). `utm_ad_id` is also kept in the stored landing URL.
- One source name: `lib/attribution/source.ts` (`fb_ad`, `fb`, `facebook` to `facebook`; `ig`, `instagram` to `instagram`; `fbclid` alone means `facebook`, `gclid` alone means `google`). Applied to new web-form touches only; old rows are not rewritten (append-only).
- WhatsApp touch for existing people; sheet Source recorded late and dated early.
- `scripts/backfill-signup-source.ts` (`npm run signups:source`): dry run by default, counts signups by reason, ids only.

Not changed: how the Weekly tab and Ad details attribute. No migration.

## Checklist for Shawn and Zhixuan (not code)

Ads (Meta Ads Manager, per ad, URL parameters):

- [ ] Every ad's website URL carries `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}`.
- [ ] Click-to-WhatsApp ads: confirm the WATI referral arrives (ad id and click id); no URL parameters apply there.
- [ ] Links in posts, Stories and bio that point to `/register` or `/enquiry` carry the same parameters.

Sheet (Ops):

- [ ] Fill the Source column for every signup, including walk-ins and returning students. Use the same words each time (referral, walk-in, returning, organic).
- [ ] Ask the person at sign-up how they heard, for staff-made enrolments.

Check after deploy:

- [ ] Run `npm run signups:source -- --from <Monday> --to <Sunday>` and read the reason counts.
- [ ] Confirm the lead_sales pages on ai.thelead.io pass the UTMs to `/api/public/leads` (their code is outside this repo).
