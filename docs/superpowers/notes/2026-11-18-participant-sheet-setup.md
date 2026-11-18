# Participant sheet sync: setup

Part 2 of the weekly ads report. The ops team's Google Sheet "LEAD Participant
List 2026" holds some signups the CRM does not. An Apps Script inside the sheet
sends its rows to the CRM, and the weekly report counts them as signups.

Nothing is shared with anyone new: the script runs as the sheet's owner and
posts to the CRM with its own key.

## Once, by a developer

1. Apply `lib/db/migrations/026_participant_sheet.sql` before the 27 Nov schema
   freeze.
2. Make a key of at least 16 random characters. Set it as `PARTICIPANT_SYNC_KEY`
   in the CRM's Netlify environment. It must not equal `PUBLIC_API_KEY`; the
   endpoint refuses a key shared with the public API.

## Once, by the sheet owner

1. In the sheet: Extensions > Apps Script. Paste `scripts/apps-script/participant-push.gs`.
2. Project Settings > Script properties > add `PARTICIPANT_SYNC_KEY`, the same
   value as the CRM's. Never put it in a cell.
3. Run `install()` once and accept the permission prompt. This adds an hourly
   trigger (newest 300 rows), a nightly trigger (every row) and a "LEAD CRM"
   menu.
4. Optional: add a column headed `Source` with a dropdown (Facebook ad,
   WhatsApp ad, Referral, Returning student, Google, Other). It says how a
   student came, and is shown as "self-reported", not credited to an ad.

## First run

1. Menu > **Check what the CRM is missing**. Writes nothing. The pop-up gives
   counts: people already in the CRM, people the sheet adds, and `sheetOnly`
   (class entries for a person who holds no CRM seat in that class).
2. Menu > **Load history once**. Rows are dated by their class, flagged
   approximate, and the report marks those weeks "(approx.)". Without this
   step the first hourly run would show about 2,000 signups in one week. It
   carries on where it stopped if Apps Script cuts it off at 6 minutes: run
   it again.
3. From then on the hourly run dates a row by the hour it first arrives.

## Class names

The sync matches a label such as `N8N: 11-12 Nov (HRDC)` to the one CRM class
starting that day, and when two start the same day, by a word of the course
name. The year is worked out from the order of the row (newest first).

Labels it cannot match are listed under "How signups were matched to ads" and
counted as "Class not known". Map one by hand:

    npm run participants:map -- --list
    npm run participants:map -- "n8n: 11-12 nov" --date 2026-11-11 --class <class code> --apply

A manual mapping is never changed by the sync. A dropdown of class names in
the sheet would make labels match themselves.

## What the sync never does

- Delete anyone. A row removed from the sheet stays in the CRM.
- Log a name, email or phone number. Results are counts only.
- Touch an existing person's details. A person found by email or phone is only
  given the class entries. A near match (same name and a second detail) is
  created and flagged `possible_duplicate_*` for review, like the help form.
