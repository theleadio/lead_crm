-- =============================================================================
-- LEAD CRM — migration 022
-- WATI's id for a message we sent under our own id.
--
--   conversation_message.provider_message_id   WATI's whatsappMessageId for
--     a row saved under an id of ours: an inbox template or auto-reply
--     ("app:<uuid>") or a lead_sales automation ("auto:<run>:<step>"), which
--     goes to WATI as local_message_id. The webhook stores it when an event
--     finds the row by our id, so later delivered / read / failed events that
--     carry only WATI's id still find it. The row keeps our id: lead_sales
--     looks its sends up by that key so a retry never sends twice.
--   conversation_message_template_out   the inbox's template suggestions
--     (lib/wati/send.ts recentTemplateNames) scan only template rows.
--
-- Nullable, no backfill: nothing has been sent this way yet.
-- Re-running is harmless. Owner: Shawn. 12 Nov 2026.
-- =============================================================================

ALTER TABLE conversation_message
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS conversation_message_provider_id
  ON conversation_message (channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_message_template_out
  ON conversation_message (created_at)
  WHERE channel = 'whatsapp' AND direction = 'out'
    AND body LIKE '[template %]';
