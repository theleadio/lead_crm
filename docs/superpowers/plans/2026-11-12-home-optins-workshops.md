# Home: class-card opt-ins and free workshops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home's Upcoming classes cards show WhatsApp opt-ins from the class's linked Meta campaigns. A new Free workshops section shows sign-ups per free workshop in the next 14 days, read from "| Lead |" campaign names.

**Architecture:**
- Two read-only queries in `lib/home/`: opt-ins per class through `class_meta_campaign` (migration 023), and sign-ups per free workshop.
- Free workshops come from parsing touchpoint `utm_campaign` names in TypeScript, then grouping.
- The dashboard page loads the workshops as its own panel, so one failing query leaves the rest of Home up (existing `panel()` helper).

**Tech Stack:** Next.js 16 (App Router, server components), postgres.js, node:test.

**Spec:** the design agreed in chat on 12 Nov 2026 (summary below), plus Shawn's answers in memory `project_shawn_answers_12nov`.
- **Class cards:** a line under the seats bar, "N WhatsApp opt-ins". N = distinct live people with a `ctwa` touchpoint whose campaign (resolved as in the ads report) is linked to the class in `class_meta_campaign`, counted over all time. With no campaign linked, the line reads "No campaign linked".
- **Free workshops section:** below Upcoming classes, header "Free workshops · Next 14 days".
  - One card per workshop: title, date, language, "N sign-ups" as the headline, and "Starts in N days". It is not a link.
  - A workshop = the "| Lead |" campaigns whose 4th part parses to the same title (case-insensitive), language and date.
  - Sign-ups = distinct live people with any touchpoint on those campaigns, over all time.
- **Free workshops don't use `class_meta_campaign`.** Their sign-ups (GHL import) carry no campaign id, and they are not classes. Tell Shawn.

## Global Constraints

- Work in worktree `C:\Users\zhish\crm-home-workshops`, branch `feat/home-optins-workshops`. Never edit `C:\Users\zhish\Desktop\learn\CRM`.
- Before writing page code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md: this Next.js differs from training data).
- Tests run against the local test DB only: `node --env-file=.env.test.local --test <file>`. `.env.local` is the production-data DB, so never run tests or seeds against it.
- On-screen text has no developer jargon: no field names, no enum values, no §refs. Code comments may have them.
- Dark theme only. Reuse the classes panel's classes and tokens.
- Who sees opt-ins and the Free workshops section: anyone with person read *without* the assigned-only limit, the same rule as the ads report (`requireReportReader`). Everyone else gets no opt-ins line and no section. This is my call: both numbers are aggregates over everyone's leads.
- Live person = `deleted_at IS NULL AND merged_into_id IS NULL`.
- Commit messages and PR body: no Claude attribution lines.

## Review Focus

1. A person who opted in on two linked campaigns, or messaged twice, counts once on the card → "counts a returning chatter once" test (Task 1).
2. A campaign linked to another class must not add to this class → "other class's campaign" test (Task 1).
3. Two spellings of one workshop ("LEAD … EN 19 Nov" and "Lead … En 19 Nov") make one card, and a person on both counts once → merge test (Task 3).
4. A Dec campaign for a Jan workshop dates it next year, and an impossible date ("31 Feb") is skipped, not crashed on → parser tests (Task 2).
5. A part-timer or any assigned-only reader sees no opt-in number and no section → permission tests (Tasks 1 and 3).

---

### Task 1: Opt-ins per class in `upcomingClasses`

**Files:**
- Modify: `lib/home/types.ts` (`HomeClass`)
- Modify: `lib/home/service.ts` (`upcomingClasses`)
- Modify: `lib/reports/ads.ts`: export `livePersonSql`, so Home reuses it and doesn't copy it
- Test: `tests/home-db.test.ts`

**Interfaces:**
- Produces: `HomeClass.optins: { linkedCampaigns: number; people: number } | null`. `null` means this viewer may not see opt-ins.
- Produces: `export function canSeeLeadCounts(viewer: Viewer): boolean` in `lib/home/service.ts`: person read allowed and not `assignedOnly`. Tasks 3 and 4 use it.
- Consumes: `campaignMapSql`, `campaignJoinSql`, `campaignIdSql`, `livePersonSql` from `lib/reports/ads.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/home-db.test.ts`. A helper `linkCtwa(classId, campaignId, adId, personId)` inserts a `meta_ad_insight` row (`ad_id`, `day` = today, `campaign_id`, required NOT NULL columns, currency `MYR`) and a `ctwa` touchpoint with `utm_ad_id = adId`. `class_meta_campaign` gets its row where the test says.
  - `it("opt-ins count people on the class's linked campaigns")`: 2 people opt in on a linked campaign → `optins` = `{ linkedCampaigns: 1, people: 2 }`.
  - `it("counts a returning chatter once")`: same person, two `ctwa` touches, on two linked campaigns of one class → `people: 1`, `linkedCampaigns: 2`.
  - `it("ignores another class's campaign and deleted people")`: a touch on a campaign linked to class B, plus a deleted person on class A's campaign → class A `people: 0`.
  - `it("a class with no campaign linked")` → `{ linkedCampaigns: 0, people: 0 }`.
  - `it("part_time sees no opt-ins")`: viewer `part_time` → `optins === null` (the classes still load).

- [ ] **Step 2: Run them to see them fail**
  Run: `node --env-file=.env.test.local --test tests/home-db.test.ts`
  Expected: FAIL. `optins` is undefined.

- [ ] **Step 3: Implement.**
  - After the existing class query, and only when `canSeeLeadCounts(viewer)` and there are classes, run one query over the returned class ids.
  - `WITH campaignMapSql, links AS (SELECT class_id, meta_campaign_id FROM class_meta_campaign WHERE class_id = ANY(ids))`, then ctwa touches of live people with `campaignIdSql` resolved.
  - `SELECT l.class_id, count(DISTINCT l.meta_campaign_id), count(DISTINCT t.person_id) … LEFT JOIN` so linked campaigns with no opt-ins still count as linked.
  - Merge into the rows by id. A class missing from the result gets `{0, 0}`.

- [ ] **Step 4: Run the tests to see them pass**, plus `tests/home.test.ts` and `tests/reports-ads-db.test.ts` (the `livePersonSql` export).
  Expected: all PASS.

- [ ] **Step 5: Commit** `feat(home): opt-ins per class from linked Meta campaigns`

### Task 2: Parse a free-workshop campaign name

**Files:**
- Create: `lib/home/workshops.ts`
- Test: `tests/home-workshops.test.ts` (pure, no DB)

**Interfaces:**
- Produces: `export type WorkshopKey = { title: string; language: "en" | "zh"; date: string /* YYYY-MM-DD */ }`.
- Produces: `export function parseWorkshopCampaign(name: string): WorkshopKey | null`.
  - Split on `|`, trim. Part 3, lowercased, must be `lead`.
  - Part 2 gives the year (`/(\d{4})$/`).
  - Part 4 must match `<title> <EN|CN> <day> <Mon…>`, case-insensitive. `CN` → `zh`.
  - When the workshop's month is before the campaign's month, the year is +1.
  - The date must exist, checked by round-trip through `Date.UTC`. Anything else → `null`.

- [ ] **Step 1: Write the failing tests:**
  - `'LEAD | Nov2026 | Lead | Vibe Coding Masterclass EN 19 Nov'` → `{ title: 'Vibe Coding Masterclass', language: 'en', date: '2026-11-19' }`
  - `'Lead | Nov2026 | Lead | Vibe Coding Masterclass Cn 12 Nov'` → `{ …, language: 'zh', date: '2026-11-12' }`
  - `'LEAD | Dec2026 | Lead | AI Night EN 5 Jan'` → `date: '2027-01-05'`
  - `'LEAD | Oct2026 | Sales | AI Automation 11 Nov'` → `null` (paid campaign)
  - `'Lead'`, `''`, `'LEAD | Nov2026 | Lead | Masterclass'` → `null`
  - `'LEAD | Feb2026 | Lead | X EN 31 Feb'` → `null`

- [ ] **Step 2: Run them to see them fail.** `node --test tests/home-workshops.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `parseWorkshopCampaign`.**
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit** `feat(home): read a free workshop from its lead campaign name`

### Task 3: `upcomingWorkshops` service

**Files:**
- Modify: `lib/home/workshops.ts`
- Modify: `lib/home/types.ts`: add `HomeWorkshop`
- Test: `tests/home-db.test.ts`

**Interfaces:**
- Produces: `export type HomeWorkshop = WorkshopKey & { signups: number; campaigns: number }`.
- Produces: `export async function upcomingWorkshops(viewer: Viewer): Promise<HomeWorkshop[]>`.
  - Throws `PermissionError("person")` when `!canSeeLeadCounts(viewer)`.
  - Sorted by date, then title.
  - Window: today in Kuala Lumpur up to +14 days, inclusive, like `upcomingClasses`.
- Consumes: `parseWorkshopCampaign` (Task 2), `canSeeLeadCounts` (Task 1).

- [ ] **Step 1: Write the failing tests.** Insert touchpoints with `channel 'import'` and the given `utm_campaign`, dated inside the window, using today's KL date + N days formatted into the name (e.g. `EN ${day} ${Mon}`).
  - `it("two spellings make one workshop; a person on both counts once")`: `LEAD | … | Lead | T EN d Mon` (people A, B) and `Lead | … | Lead | t En d Mon` (people B, C) → one workshop, `signups: 3`, `campaigns: 2`.
  - `it("skips paid campaigns, deleted people and workshops past 14 days")`.
  - `it("part_time is refused")` → rejects with `PermissionError`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - SQL: `SELECT DISTINCT t.utm_campaign, t.person_id FROM touchpoint t JOIN person p … WHERE t.utm_campaign ILIKE '%|%lead%|%' AND livePersonSql`.
  - Then parse, group by `title.toLowerCase()|language|date`, and count distinct person ids per group in TypeScript.
  - Display title = the spelling with the most sign-ups.
  - Add a comment: `// shortcut: groups in TypeScript over every lead-campaign touch; move into SQL if lead touches pass ~50k.`
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit** `feat(home): free workshops with sign-ups from lead campaigns`

### Task 4: Show both on Home

**Files:**
- Modify: `app/(app)/(crm)/dashboard/classes-panel.tsx` (`SeatCard`)
- Create: `app/(app)/(crm)/dashboard/workshops-panel.tsx`
- Modify: `app/(app)/(crm)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `HomeClass.optins` (Task 1), `upcomingWorkshops` / `HomeWorkshop` (Task 3), `canSeeLeadCounts` (Task 1).

- [ ] **Step 1: Classes card.**
  - In `SeatCard`, between the seats bar and the footer:
    - `optins === null` → render nothing;
    - `linkedCampaigns === 0` → muted "No campaign linked";
    - otherwise "`{people}` WhatsApp opt-ins", with the number in `tabular-nums font-semibold`.
  - Same `text-xs` scale as the footer.
- [ ] **Step 2: `WorkshopsPanel({ workshops, windowLabel })`.**
  - A copy of the `ClassesPanel` header, titled "Free workshops", with no "All" link.
  - Empty state: "No free workshop in the next 14 days."
  - Card: the `SeatCard` shell as a `<div>`, not a `Link`. It shows the title; the date (`formatDate`) · English/中文; `signups` large plus "sign-ups"; and the "Starts in …" label.
  - Reuse `startsLabel`/`daysUntil`: export them from `classes-panel.tsx` rather than copying.
- [ ] **Step 3: `page.tsx`.**
  - Add `canSeeLeadCounts(user) ? panel("free workshops", () => upcomingWorkshops(user)) : null` to the `Promise.all`.
  - Render it directly under the classes panel, with `<PanelError what="free workshops" />` on failure. Use the same `windowLabel`.
- [ ] **Step 4: Check it in the browser.**
  - Start a dev server from the worktree on a free port, after running `netstat -ano | grep LISTENING`. Not 3000 or 3006.
  - Point it at the test DB. Add one `class_meta_campaign` row and a few touchpoints there.
  - Check at desktop width and at 375px: the card line, the "No campaign linked" state, and the section with its empty state.
  - Stop the server afterwards, and say that it showed test data.
- [ ] **Step 5: Run the full suite** (`node --env-file=.env.test.local --test "tests/**/*.test.ts"`) and `npx tsc --noEmit` and `npm run lint`. Expected: no new failures.
- [ ] **Step 6: Commit** `feat(home): show opt-ins on class cards and a free workshops section`, then open the PR when Zixuan asks.
