# lead_sales: automations (draft)

**Date:** 4 Nov 2026 · **Status:** draft. Will change once the SalesProcess feature map is in · **Parent:** `2026-11-04-lead-sales-platform-design.md` §4

## 1. Goal

Repeat work runs by itself: "when X happens, do Y". These are the flows the team named:

- **Enrolment confirmed** → send the onboarding email and WhatsApp, with the LMS link `https://class.thelead.io/` and "check your email for your temporary password".
- **New lead** → add a tag, and give sales a follow-up task.
- **Meta lead** → the same as a new lead (it arrives through the Meta intake draft).

This replaces SalesProcess "Workflows". Version 1 is a **list of rules edited in a form**, not a drag-and-drop canvas. The canvas can come later, once the feature map shows how much of it the team really uses.

## 2. What already exists in `lead_crm`

- **`event_outbox` + `lib/events/drain.ts`.** Every important change raises an event: `LeadCaptured`, `DealStageChanged`, `EnrolmentCreated`, `EnrolmentConfirmed`, `EnrolmentCancelled`, `EnrolmentTransferred`, `PaymentRecorded`, `ClassChanged`, `ClassCancelled`, `ClassPublished`, `EnquiryConverted`, `ConsentChanged`, and more. The drain retries 5 times, waiting 30 s, 2 min, 10 min and 1 h, then dead-letters.
- **`consent` / `consent_current`.** The latest consent per person and purpose: `marketing_email`, `marketing_whatsapp`, `data_processing`.
- **`message_log`.** Every WhatsApp and email message, in and out.
- **`enrolment.onboarding_step`.** The original spec meant it as the onboarding sequence's progress counter.
- **`task`.** Already used by the existing handlers (`opsTask` in `lib/events/handlers.ts`).

The original spec says screens never send messages; workers do. Automations are those workers.

## 3. Model

An **automation** is a trigger, optional conditions, and ordered steps.

| Part | v1 options |
|---|---|
| **Trigger** | Any outbox event above. Plus new ones from `lead_sales`: `MessageReceived`, `TicketCreated`, `TagAdded`. Plus time-based triggers: "N days before class start", "N days after enrolment". |
| **Condition** | Field checks on the event's person, deal, enrolment or class, e.g. language = zh, course = X, funding = HRDC, has tag Y. |
| **Step** | Send a WhatsApp template (WATI) · send an email template · add or remove a tag · create a task · change a deal stage · wait N hours or days · stop if a condition becomes true (e.g. "stop if replied") |

Tables (proposed, in the `lead_sales` schema; see the build plan):

- `automation`: name, trigger, conditions (JSON), active, created_by.
- `automation_step`: automation_id, position, kind, settings (JSON).
- `automation_run`: one per trigger firing per person. Status, current step, `next_run_at`.
  - It is unique on (automation_id, source event id), so a replayed event never starts a second run.
- `automation_run_log`: what each step did, or why it was skipped.

**Waits:** a run that reaches "wait 2 days" stores `next_run_at` and stops. A scheduled worker picks up due runs, the same pattern as the outbox drain.

## 4. Rules that are not optional

- **Consent.** A marketing message to someone without `marketing_email` / `marketing_whatsapp` consent is skipped, and the skip is logged.
  - **Decided 4 Nov:** onboarding, class reminders and other course messages are *service* messages. They go to paying students without marketing consent. Newsletters and promotions are marketing and need consent. This is the team's decision; it hasn't been reviewed by a PDPA specialist.
- **WhatsApp outside the reply window.** Automated WhatsApp messages must use Meta-approved templates. I understand free text is only allowed within a 24-hour window after the customer writes, but that needs verifying against Meta's current rules. The templates live in WATI, as the original spec says.
- **No double sends.** Each send step checks `sales.message` for the same template, person and run first.
- **Kill switch.** Each automation can be paused. Pausing stops new runs and holds the waiting ones.

## 5. First flows to build

1. **Onboarding**, triggered by a new event `LmsAccountReady`:
   - The LMS handler raises `LmsAccountReady` when the LMS answers `200` to `enrolment.confirmed` (handoff doc, §5). Starting from that event, not from `EnrolmentConfirmed`, means the account and temp-password email already exist. No polling is needed.
   - If the LMS notice dead-letters, onboarding never starts, and the Ops task from the handoff doc is the alarm.
   - Pick the template language from the class language (decided 4 Nov, main spec §7.4).
   - A student with no email gets WhatsApp only, plus the Ops task to add an email.
   - send the onboarding email and the WhatsApp template, both with the class details, `class.thelead.io` and the temp-password note
   - set `onboarding_step`
2. **New lead follow-up** (`LeadCaptured`): add the tag "new lead", then create a sales task due the next working day.
3. **Class reminder** (time-based): 2 days before class start, send the WhatsApp template with venue or online link.

## 6. Open questions

- Which email service sends onboarding and transactional email? Not chosen yet.
- Which WhatsApp templates are already approved in WATI?
- Who may create or edit automations? Proposed: `marketing` and `management`.
- Should existing SalesProcess workflows be rebuilt one-to-one? The feature map will list them.
