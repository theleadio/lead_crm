-- =============================================================================
-- LEAD CRM — migration 021
-- The WhatsApp after-hours auto-reply (decided 4 Nov: "Thanks, we'll reply by
-- the next working day", once per conversation per evening;
-- lib/wati/auto-reply.ts).
--
--   conversation.after_hours_reply_until   the opening time (next 08:30 on a
--     working day) of the after-hours stretch this thread was last answered
--     in. A reply is sent only when it is earlier than the current stretch's,
--     so one stretch gets one reply, however many messages come.
--   conversation_message.automated         sent by the system, not a person.
--     WATI's echo of an automated message does not count as staff's first
--     response, so the enquiry's reply deadline keeps running.
--
-- Nullable / default false, no backfill: no auto-reply has been sent yet.
-- Re-running is harmless. Owner: Shawn. 11 Nov 2026.
-- =============================================================================

ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS after_hours_reply_until timestamptz;
ALTER TABLE conversation_message
  ADD COLUMN IF NOT EXISTS automated boolean NOT NULL DEFAULT false;
