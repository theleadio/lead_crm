# Link Meta campaigns to a class — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Zixuan chose native execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** On a class's Details tab, staff link the Meta campaigns that sell the class. This fills `class_meta_campaign` (migration 023, in production), which Home's opt-ins line reads.

**Architecture:** A service in `lib/classes/campaigns.ts` (read choices, link, unlink, each audited), one route `app/api/classes/[id]/campaigns` (POST link, DELETE unlink), and a client panel on the Details tab.

**Tech Stack:** Next.js 16 server/client components, postgres.js, node:test.

**Spec:** the design agreed in chat on 12 Nov:
- **Panel "Meta campaigns"** on the Details tab, listing linked campaigns: name, last day with spend, Remove.
- **"Link a campaign"** picker: campaigns that spent in the last 90 days (from the daily Meta sync). Suggested first: the name's event part has the class's start day and month.
- **A campaign linked to another class** is shown but disabled, with "sells <class code>": one campaign, one class (Shawn's review note).
- **Every link and unlink is audited** (Shawn's review note).
- **Who may link:** super_admin, operations, marketing, management (Zixuan, 12 Nov). Everyone who can read the class sees the list.

## Global Constraints
- Worktree `C:\Users\zhish\crm-class-campaigns`, branch `feat/class-campaign-link`, off main 2652425.
- Tests only on the test DB: `node --env-file=.env.local --env-file=.env.test.local --test …`.
- No developer jargon on screen. Dark theme only. Reuse `Panel`/`Row`, `Button`, and the `class-controls.tsx` fetch pattern.
- Store Meta's numeric campaign id. The name is display only.
- No Claude attribution in commits or PR.

## Review Focus
1. The same campaign clicked "Link" on two classes at once: the second is refused with "sells <code>", not given a 500.
2. Linking a campaign twice on the same class is a no-op, not an error.
3. A campaign renamed in Meta shows its latest name in the picker and the list.
4. A part_time or sales user can read the list but can't link (403 from the route, refused in the service).
5. A class with no campaigns, and a picker with no recent campaigns, both show a clear empty state.

### Task 1: Service `lib/classes/campaigns.ts`
- `canLinkCampaigns(viewer): boolean` (the four roles).
- `suggestsClass(campaignName: string, startDate: string): boolean`, pure. It takes the parts after the 3rd `|` and checks the start day as a standalone number (`(^|\D)14(\D|$)`) plus the month abbreviation as a word start.
- `classCampaigns(classId, viewer): Promise<{ linked: LinkedCampaign[]; choices: CampaignChoice[] }>`.
  - `LinkedCampaign = { campaignId; name; lastDay: string | null }`. The name is Meta's latest, or the stored name when there are no rows.
  - `CampaignChoice = { campaignId; name; lastDay; suggested; linkedTo: string | null }`: spent in the last 90 days, not linked to this class. Sorted suggested first, then by `lastDay` descending.
  - Meta rows follow the `META_AD_ACCOUNT_ID` filter, like `campaignMapSql`.
- `linkCampaign(viewer, classId, campaignId)` returns `{ ok: true } | { ok: false; reason: "not_found" | "unknown_campaign" } | { ok: false; reason: "linked_elsewhere"; classCode }`.
  - Runs in one transaction, with `ON CONFLICT (class_id, meta_campaign_id) DO NOTHING`. A unique violation on `class_meta_campaign_one_class` maps to `linked_elsewhere`.
  - Audit `create`, entity `class`, entityId = class id, after `{ linkedCampaign: { id, name } }`, only when a row was inserted.
- `unlinkCampaign(viewer, classId, campaignId) → { ok: true; removed: boolean }`: audit `delete` when a row was removed.
- Tests: `tests/class-campaigns.test.ts` (suggestsClass) and `tests/class-campaigns-db.test.ts`:
  - link + audit;
  - relink is a no-op;
  - another class is refused with its code;
  - unknown campaign;
  - unlink + audit;
  - sales refused;
  - choices: 90-day window, latest name, linkedTo marked, suggested order.

### Task 2: Route `app/api/classes/[id]/campaigns/route.ts`
- POST and DELETE with body `{ campaignId: /^\d+$/ }`.
- Responses: 401; 403 through `forbidden()`; 400 through `validationError`; 404 class; 422 unknown campaign; 409 "This campaign already sells <code>. Unlink it there first."; 200 `{ ok: true }`.

### Task 3: Panel on the Details tab
- `class-campaigns.tsx` (client), with props `{ classId, linked, choices, canLink }`.
- Picker: `<select>` with optgroups "Suggested" and "Other campaigns". Options linked elsewhere are disabled and show "· sells <code>". A Link button, Remove per row, an error line, and `router.refresh()` on success. Helper text: "A campaign can sell only one class."
- `page.tsx` loads `classCampaigns` on the Details tab and passes it to `DetailsTab`.
- Browser check on the test DB, desktop and 375px.
