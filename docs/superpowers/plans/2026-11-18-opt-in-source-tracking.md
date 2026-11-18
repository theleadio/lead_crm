# Opt-in source tracking: plan (draft, 18 Nov 2026)

Status: draft for Shawn and Zhixuan. Nothing here is built. Counts were read from production on 18 Nov (read-only) and from SalesProcess form analytics.

## Problem

Most leads have a phone and an email but no record of where they opted in.

| Fact (production, 18 Nov)                                | Number                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| People                                                   | 15,778                                                              |
| People with any touchpoint                               | 15,708                                                              |
| First touch says only `ghl-export` (the import label)    | 15,496                                                              |
| First touch with a UTM source, landing page or ad source | 1,217 (about 8%)                                                    |
| First touches with a campaign                            | 0 (campaign sits on separate `ghl-attribution` touches, 7,514 rows) |
| People with at least one tag                             | 12,443 (194 tags)                                                   |

New click-to-WhatsApp leads are tracked well (1,785 `ctwa` touches with source, landing page and click id). The gap is everything else: forms, events, email, referrals, communities, JooY Ticket and the old export.

## What "opt-in source" must answer

For every person, at the time they first gave their details:

1. **Source type:** paid ad, organic social, email, WhatsApp, WhatsApp community, referral, event (online or in person), website direct, partner ticket (JooY), import.
2. **Entry point:** the exact form, landing page, ad, webinar or masterclass, e.g. "18 Nov Vibe Coding masterclass form".
3. **Detail:** UTM source, medium, campaign and click ids when they exist.
4. **When:** the real opt-in date, not the import date.

## What we found

- **Tags already carry the entry point for thousands of people.** Examples: `[source] meta ads` 2,643; `[event] webinar - registrant` 1,701; `[event] 哲理有 ai - registrant` 799; `[event] han-picked ai - registrant` 644; `[masterclass] 30 sept aie` 890; `[masterclass] 23 sept data science` 646; `facebook form` 431; `ai video challenge` 467; `penang 2122 follow up` 2,363. About 6,100 people have a source-like tag (broad wording match, approximate).
- **Tag dates are not opt-in dates.** 154 of the 159 tags with 20 or more people were tagged on 30 Oct, the import day. A tag says what, not when. Dates have to come from the event name (e.g. "18 nov"), or stay empty.
- **Forms not imported.** The importer reads only the two workshop forms (`ghl-forms`). SalesProcess forms for 20 Aug to 18 Nov: about 4,700 views over 23 forms; about 3,600 of those views are on forms the CRM does not read (Programme Signup 1,712; Agentic Automation interest 506; Engineering 459; Full-Stack EN 409; Data Science 238; Full-Stack CN 94; Automation CN 89). Responses are likely 1,000 to 1,500 (estimate at the 37% completion rate; real counts need the Submissions export).
- **Custom fields not imported.** SalesProcess has 66 contact custom fields in 19 folders, many filled by forms: Payment Method (self-funded or HRDC), preferred months, In-house training, and fields from the HRDC Intention Form, the Chinese workshop form and Form 16 and 38.
- **UTM values are messy.** Sources include `an`, `fb`, `ig`, `facebook`, `fb_ad`, and an ad-set name sometimes sits in `utm_medium`.

## Plan

### Phase 1: Decide the model (before the 27 Nov schema freeze)

`touchpoint` rows are append-only (a trigger forbids UPDATE and DELETE), so old rows cannot be corrected. Backfill means inserting new rows.

Recommended: one migration adding two nullable columns to `touchpoint`, `source_type` (a short checked list) and `entry_point` (text). Backfill inserts derived touches with `channel = 'import'` and an `external_ref` like `tag-backfill:<person>:<tag>`, so a re-run adds nothing. Reports read the earliest touch that has a `source_type`.

Alternative with no schema change: write the entry point into `form_name` as `tag:<name>`. Cheaper, but cannot be filtered by source type.

Decision needed from Shawn: migration before freeze, or `form_name` only.

### Phase 2: Tag-to-source backfill (dry run first)

- Build a mapping file from tag name to `source_type` and `entry_point`. Start with the 159 tags that have 20 or more people (the full list is in the production query; 35 tags are lower).
- Rules in the file, in order: `[source] ...`, `[event] ...`, `[masterclass] ...`, `[workshop] ...`, `[course] ...`, `[interest] ...`, then free-text tags by exact name. Tags that are not sources (`[language] ...`, `[live] ...`, `[onboard] ...`, attendance and cleaning tags such as `cold lead`, `... attendee`, `... cancel`) map to nothing.
- Date: use the date in the event name when it has one; otherwise leave `occurred_at` empty-equivalent (the import day, flagged `date_unknown` in the `external_ref`).
- Script `scripts/backfill-tag-source.ts`: dry run by default (counts per tag, unmapped tags, people who would gain a source); `--apply` writes. Same shape as `import-ghl-opportunities.ts`.
- Rule from the cutover plan: imports must not fire events. Use plain SQL inserts, never `captureLead()`. Verify on staging that no `automation_run` rows appear.
- Done when: dry run counts match the mapping, a re-run adds 0 rows, and 10 spot checks against SalesProcess agree.

### Phase 3: Form submissions and custom fields

- Export Submissions for the interest, HRDC, Programme Signup and recurring forms (Sites, Forms, Submissions, one form at a time).
- Match to CRM people by email, then phone. Add one touch per submission with the form name as `entry_point`.
- Import the form-filled custom fields that matter for sales (Payment Method, preferred months, In-house training) as tags or a note; do not create new person columns before freeze.
- PDPA: no consent rows are written. A form submission is not proof of marketing consent (spec §14).

### Phase 4: Capture it correctly from now on

- Every public entry point records `source_type` and `entry_point`: `/register`, `/enquiry`, `/schedule` cards, lead_sales page forms, and the SalesProcess forms until 14 Dec.
- UTM rules for anything we publish (ads, emails, WhatsApp community links, bio links, `tlead.io` short links): `utm_source` from a fixed list (`facebook`, `instagram`, `google`, `email`, `whatsapp`, `community`, `youtube`, `referral`), `utm_medium` from a fixed list (`paid`, `organic`, `broadcast`), `utm_campaign` the campaign name only. Ad-set names go in `utm_content`, not `utm_medium`.
- WhatsApp inbound (WATI) has no UTM: record the entry point from the template or the click-to-WhatsApp ad where one exists.
- JooY Ticket sign-ups arrive outside the CRM: decide with Zhixuan whether they are imported.
- Normalise existing UTM values in a view or report (`an`/`fb`/`facebook`/`fb_ad` to Facebook paid), not by editing rows.

### Phase 5: Measure it

Add a "source completeness" figure to the reports: share of people created in the last 30 and 90 days with a `source_type` and an `entry_point`, split by entry channel. Target before 14 Dec: 95% of new leads; the old import is reported separately.

## Open decisions

1. Phase 1 model (migration or `form_name` only), before 27 Nov.
2. Whether JooY Ticket stays, and how its buyers reach the CRM.
3. Who maps the free-text tags (Alicia and Shawn know what `penang 2122 follow up` or `aa no turn up` mean). Proposal: Zhixuan builds the mapping file; Alicia and Shawn fill the "source type" column.
4. Whether to export all-time form submissions (SalesProcess analytics only goes back 90 days).

## Not covered

Messenger and Instagram DMs, offline walk-ins, and individual contact notes (not imported by design, per the cutover plan).
