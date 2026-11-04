# CRM → LMS hand-off: message contract

**Date:** 4 Nov 2026 · **Status:** draft for team review · **Parent:** `2026-11-04-lead-sales-platform-design.md` §3.6

Decided 4 Nov: the CRM sends sign-up data to the LMS. Our team owns both ends. The CRM never writes into the LMS database.

## 1. What exists today

- **Direction is LMS → CRM.** `scripts/sync-lms.ts` runs daily in `daily-sync.yml`. It reads the LMS (`participants`, `enrollments`, `cohorts`, `courses`) and upserts into the CRM.
- **Ids are shared.** CRM `course.id`, `class.id` and `enrolment.id` are the LMS `courses.id`, `cohorts.id` and `enrollments.id`.
- **People are matched by email.** A participant whose email is already in the CRM maps to that person. A participant's id is not a CRM id.
- **The sync sets status itself.** It writes `confirmed`, or `completed` once the cohort has ended. It knows nothing of CRM statuses such as `cancelled` or `transferred`.
- **The outbox already retries.** `lib/events/drain.ts` makes 5 attempts, waiting 30 s, 2 min, 10 min and 1 h between them. After the 5th failure the row becomes a dead letter until `retryDeadEvents()` revives it. Handlers can run twice, so they must be idempotent.
- **There is no `EnrolmentCompleted` event yet.** `lib/events/types.ts` has `EnrolmentConfirmed`, `EnrolmentCancelled` and `EnrolmentTransferred`, but nothing for completion.

## 2. The decision this forces: one owner per field

Once the CRM sends enrolments to the LMS, the daily sync must stop writing enrolment **status** into the CRM. Otherwise it can put a CRM-cancelled enrolment back to `confirmed`: it upserts with `ON CONFLICT DO UPDATE` whenever the price differs.

Proposal:

| Data | Owner after go-live | Sync LMS → CRM |
|---|---|---|
| Enrolment exists, status, price, payer | **CRM** | Stops writing these |
| Course and class (cohort) details | CRM for new ones; LMS-created ones are still imported | Keeps importing, insert only |
| Certificate number | **LMS** (issues it) | Comes back in the reply (§5); the sync may also copy it |
| Attendance and completion | **LMS** | Reported back with `enrolment.completed`, or by the sync. Decide which (§7) |

## 3. Transport

- **Request:** HTTPS `POST` to one LMS endpoint. Proposed path `/api/crm/events`; the host depends on how the LMS is deployed.
- **Body:** JSON, UTF-8.
- **Sender:** a new outbox handler in `lib/events/handlers.ts`, so retries and dead letters come for free.
- **Secret:** `LMS_WEBHOOK_SECRET`, set in Netlify for the CRM and in the LMS's own environment. Never commit it to git; the repo is public.

### Signature

- **Header:** `X-Lead-Timestamp: <unix seconds>`
- **Header:** `X-Lead-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with LMS_WEBHOOK_SECRET>`
- **Checks on the LMS side:**
  - Reject a timestamp more than 5 minutes from its own clock.
  - Compare signatures in constant time.
  - Return 401 on any mismatch.

### Idempotency

- **Message id:** every message carries `messageId`, which is the `event_outbox.id`. The LMS stores the ids it has processed and answers a repeat with the same result.
- **Writes:** the LMS upserts by the CRM ids (`enrolment.id`, `class.id`, `course.id`). A replay can never create duplicates.

## 4. Messages

Envelope shared by all messages:

```json
{
  "messageId": "uuid (event_outbox.id)",
  "type": "enrolment.confirmed",
  "sentAt": "2026-11-04T04:30:00Z",
  "data": { }
}
```

### 4.1 `enrolment.confirmed`

**Trigger:** the existing `EnrolmentConfirmed` event.

**What the LMS does:**
1. Find the participant by email (case-insensitive), or create one.
2. Upsert the course and the cohort.
3. Upsert the enrollment with `id = enrolment.id`.
4. Send the student their login details, if the LMS does that (§7).

```json
{
  "enrolment": {
    "id": "uuid",
    "status": "confirmed",
    "payerType": "self | company",
    "pricePaidMyr": "1500.00",
    "fundingType": "self | company | hrdc | other",
    "confirmedAt": "ISO 8601"
  },
  "person": {
    "id": "uuid (CRM person id)",
    "fullName": "text",
    "email": "text, required",
    "phoneE164": "+60… or null",
    "companyName": "text or null",
    "preferredLanguage": "en | zh"
  },
  "class": {
    "id": "uuid (= LMS cohort id)",
    "code": "text",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "language": "en | zh",
    "mode": "in_person | online | hybrid",
    "onlineUrl": "text or null"
  },
  "course": {
    "id": "uuid (= LMS course id)",
    "name": "text",
    "nameCn": "text or null"
  }
}
```

The CRM data is incomplete for this message:
- **Email may be missing.** The CRM allows a person with no email. The LMS can't create a login without one, so the CRM must not send then. Instead it creates an Ops task saying "Add an email so the LMS account can be made".
- **Funding types don't line up.** The LMS has `leaders_club`, and the CRM `funding_type` doesn't. That needs agreeing (§7).

### 4.2 `enrolment.cancelled`

**Trigger:** the existing `EnrolmentCancelled` event. **Data:** `{ "enrolmentId", "reason" }`.

**What the LMS does:** remove the student's access to the cohort. It keeps the row, marked cancelled.

### 4.3 `enrolment.transferred`

**Trigger:** the existing `EnrolmentTransferred` event. **Data:** `{ "enrolmentId", "fromClassId", "toClassId", "newEnrolmentId" }`, plus the `class` and `course` blocks for the new class.

**What the LMS does:** move the student to the new cohort under `newEnrolmentId`, and cancel the old enrollment.

### 4.4 `enrolment.completed`

**Trigger:** a new outbox event, `EnrolmentCompleted`, raised when the CRM status moves to `completed`. **Data:** `{ "enrolmentId", "completedAt" }`.

**What the LMS does:** issue the certificate, then reply with its number (§5).

Whether this message is needed depends on who marks completion (§7). If the LMS marks it, the direction flips: the LMS tells the CRM, or the sync copies `certificate_no` back.

## 5. Replies

| LMS answer | Meaning | CRM does |
|---|---|---|
| `200` + JSON body | Done (also for a repeat `messageId`) | Marks the outbox row processed and stores any returned fields |
| `409` | The LMS isn't ready, e.g. completed arrived before confirmed | Throws, so the outbox retries later |
| `400` / `422` | The message is invalid | Throws. The row becomes a dead letter after 5 tries, and an Ops task shows the error |
| `401` | Bad signature or clock skew | Throws. Check the secret or the clock |
| `5xx`, timeout | The LMS is down | Throws, so the outbox retries |

`200` bodies:

```json
// enrolment.confirmed
{ "participantId": "LMS id", "enrollmentId": "= enrolment.id", "accountCreated": true }

// enrolment.completed
{ "certificateNo": "text", "certificateUrl": "https://… or null" }
```

The CRM writes `certificateNo` to `enrolment.certificate_no`, which is unique in the schema. A clash comes back as an error, not a silent overwrite.

## 6. Build steps, once agreed

1. **CRM:** add an `EnrolmentCompleted` event, if §7 keeps it.
2. **CRM:** add a `lib/lms/send.ts` client that signs requests, has a timeout, and returns the parsed reply. Then add the handlers for the four messages.
3. **CRM:** change `scripts/sync-lms.ts` to follow the ownership table in §2. **This must ship at the same time as the handlers.**
4. **LMS:** add the endpoint: verify, check idempotency, then upsert. Its tests use the same sample bodies as the CRM's.
5. **Both:** test against a staging LMS, then switch on with an env flag, `LMS_HANDOFF_ENABLED`.

## 7. Open questions (our team)

- **Completion:** does the LMS mark completion (attendance lives there), or does the CRM? This decides whether `enrolment.completed` goes CRM → LMS or the other way.
- **Login details:** does the LMS email the student their login? Or does the CRM's onboarding message include a link?
- **Funding types:** how do the CRM's `funding_type` values map to the LMS's, including `leaders_club`?
- **LMS endpoint:** where does it live: an LMS app route, or a Supabase Edge Function?
- **Old classes:** for classes created in the CRM before go-live, send a one-off backfill, or only send new confirmations?
- **Certificate:** which template, what does the certificate number look like, and is a PDF link returned?
