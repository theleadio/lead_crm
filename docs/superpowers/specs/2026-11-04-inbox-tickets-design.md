# lead_sales: inbox and tickets (draft)

**Date:** 4 Nov 2026 · **Status:** draft. It will be revised once the SalesProcess feature map comes in · **Parent:** `2026-11-04-lead-sales-platform-design.md` §4

## 1. Goal

Put all customer messages in one inbox: WhatsApp (via WATI), Facebook Messenger, email, and the website help form. Any message can become a **ticket**. A ticket is routed to the team that can answer it:

| Team | Topics (from the team's notes) |
|---|---|
| **Finance** | e-invoice, receipt |
| **Tech** | voucher, API key |
| **Support** (default) | everything else |

Facebook Messenger is assumed until the feature map confirms it. The email provider for the support inbox isn't chosen yet.

## 2. What we reuse from `lead_crm`

`lead_sales` shares the CRM database, so it reuses these:

- **`person`, with dedupe in `lib/people/`.** Each inbound sender is matched to a person by phone (E.164) or email. A new sender becomes a new person.
- **`integration_event`.** Webhooks land here first. `UNIQUE (source, external_event_id)` already makes them idempotent.
- **`message_log`.** It already holds WhatsApp and email messages per person, both in and out. Today its `channel` only allows `whatsapp` and `email`. `lead_sales` reads it, for older history and the CRM's own sends, but doesn't write it.
- **`app_user` and roles.** The roles are super_admin, management, marketing, sales, support, operations and part_time. There is **no Finance or Tech role**, so teams are a new concept (§3).
- **`task`.** It stays for internal to-dos. Tickets are separate, because a ticket has a customer on the other end and a conversation.

## 3. Data model (proposed; every change goes through Shawn)

**`sales.message`** (decided 4 Nov: `lead_sales` keeps its own table and doesn't write the CRM's `message_log`):
- Columns: `conversation_id`, `person_id`, `channel` (`whatsapp | email | messenger | web_form`), `direction`, `external_message_id` (unique per channel), `body`, `attachment_paths text[]` (files go to storage, not the database), `sent_at`, `status`.
- The CRM person timeline reads it as well, through a read-only view, so each person still has one history.

**`conversation`.** One thread with a person on one channel.
- Columns: `person_id`, `channel`, `external_thread_id` (unique per channel), `status` (`open | snoozed | closed`), `assigned_user_id`, `last_message_at`, `last_inbound_at`.

**`ticket`.**
- `number`: human-readable, e.g. `T-000123`, from a sequence.
- `person_id`, `conversation_id` (nullable, since web-form tickets may have none), `source_channel`.
- `category` (from `ticket_category`), `team_id`, `assigned_user_id`.
- `status`: `new | open | waiting_customer | resolved | closed`.
- `priority`: `low | normal | high`.
- `subject`, `first_response_at`, `resolved_at`, `sla_due_at`.

**`ticket_category`.**
- Columns: `code`, `label_en`, `label_zh`, `team_id`, `active`.
- Seed rows:
  - `einvoice` → Finance
  - `receipt` → Finance
  - `voucher` → Tech
  - `api_key` → Tech
  - `general` → Support

**`team` and `team_member`.**
- Teams: Finance, Tech, Support.
- Members: `app_user` rows. One person can be in several teams.

**`ticket_rule`.** An ordered list. The first rule that matches wins.
- Columns: `position`, `match_channel` (nullable), `match_keywords text[]` (nullable), `match_form_category` (nullable), `set_category`, `set_team_id`, `assign_mode` (`round_robin | fixed | none`), `assign_user_id`.

**`ticket_event`.** History: status changes, reassignments, and internal notes. It is append-only, like `consent`.

## 4. How a message flows

1. **Webhook in.** WATI, Meta or the email provider posts to `lead_sales`. We verify the provider's signature, then store the raw payload in `integration_event`, using its unique key to stop duplicates.
2. **Match the person.** Use phone or email through the existing dedupe. If the match is uncertain, the person gets flagged `needs_review`, as the CRM does today.
3. **Find or open the conversation**, then insert a `sales.message` row (`direction = in`).
4. **Route it.**
   - **Help form:** the customer picks a category on the form, so the ticket is created straight away with that category, team and assignee. This is deterministic, so no guessing.
   - **Chat or email:** the message waits in the inbox. An agent clicks **Make ticket** and picks a category, and the team and assignee follow from `ticket_category` and `ticket_rule`.
   - **Optional keyword rules:** for example, "invoice", "e-invoice" or "receipt" → Finance; "voucher" or "API key" → Tech. They only *suggest* a category in v1, so a wrong keyword can't misroute anything.
   - **Phase 4, AI:** AI suggests the category and drafts an answer. A person still confirms.
5. **Assign.** `round_robin` picks the team member who was given a ticket longest ago, skipping inactive users.
6. **Reply.** It is sent through the same channel and logged as `sales.message` with `direction = out`. Note:
   - WhatsApp and Messenger only allow free-form replies for a limited time after the customer's last message; I believe that window is 24 hours for both. Outside it, WhatsApp needs a Meta-approved template. **Check both rules against Meta's current documentation**, because they change.
   - `conversation.last_inbound_at` is stored so the composer can warn the agent when the window has closed.

## 5. Screens

- **Inbox:**
  - Conversations list, filtered by channel, assignee and unread.
  - Thread view.
  - Composer, with the reply-window warning.
  - Person panel, linked to the CRM person and their deals and enrolments.
- **Tickets:**
  - List, filtered by team, status and assignee. "My tickets" is the default.
  - Detail page with status, category, assignee, the linked conversation, internal notes and history.
- **Help form:** on the new website. Category dropdown, name, email or phone, message, and an attachment. Consent wording as in the CRM's public forms. Open to anyone (decided 4 Nov), so it reuses the CRM's public-form protection: the CAPTCHA check and rate limit in `lib/public/guard.ts`.
- **Settings:**
  - Teams and members.
  - Categories.
  - Rules, as an ordered list you can drag to reorder.
  - Channel connections.

## 6. Permissions (proposed)

- A team member sees and works the tickets of their own teams.
- `super_admin` and `management` see everything.
- Finance tickets can contain invoice data, so other teams can't open them.
- Conversations are visible to `support`, `sales`, team members for their own tickets, `super_admin` and `management` (decided 4 Nov).

## 7. Open questions

- ~~Instagram DM~~: included alongside Facebook Messenger (decided 4 Nov). Both come through Meta; check the exact webhooks and permissions against Meta's current docs.
- Which provider receives support email?
- ~~SLA~~: first reply within 24 hours for every team (decided 4 Nov). Counted in **office working hours** (decided 4 Nov): Monday–Friday, 8:30 AM–4:30 PM, Malaysia time (Asia/Kuala_Lumpur, assumed). The deadline is **the same time on the next working day**. Examples: in Tuesday 10 AM → due Wednesday 10 AM; in Friday 5 PM (after hours) → counts from Monday 8:30 AM, due Tuesday 8:30 AM; in Friday 3 PM → due Monday 3 PM. National plus KL/Selangor public holidays are non-working days (decided 4 Nov). The holiday list has to be kept up to date each year, in a `holiday` table edited in Settings.
- Who's in Finance and in Tech, and are they `app_user` accounts already? (User will confirm.)
- Should a resolved ticket send the customer a closing message or survey?
- ~~After hours~~: auto-reply "Thanks, we'll reply by the next working day", once per conversation per evening, in the class language or else the person's (decided 4 Nov). On WhatsApp outside the reply window this needs an approved template.
- ~~Overdue tickets~~: dashboard only, as a red overdue list sorted by deadline, with no notifications (decided 4 Nov).
- ~~Customer reply on a resolved ticket~~: opens a **new** ticket linked to the old one, which stays closed (decided 4 Nov). Add `ticket.previous_ticket_id`.
- ~~Retention~~: conversations and attachments are kept indefinitely and deleted on request, the same as CRM people (decided 4 Nov).
- ~~Help form~~: open to anyone (decided 4 Nov). It needs spam protection (a captcha or similar) and rate limiting.
- ~~Read access~~: everyone in `support` and `sales`, plus team members for their own tickets, plus `super_admin` and `management` (decided 4 Nov).
