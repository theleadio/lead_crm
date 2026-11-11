-- =============================================================================
-- LEAD CRM — migration 020
-- conversation_message.imported: set by the WhatsApp history import
-- (lib/wati/history.ts; SalesProcess cutover plan WP5, rule "imports never
-- fire events"). Moved from lead_sales (its PR #20, migration 005 there) with
-- the inbox, migration 019.
--
-- lead_sales' automations trigger "customer message received" skips imported
-- rows, so copying old chats in never starts a flow. The import also stamps
-- created_at with the message's own time, so nothing looks new to the
-- watchers either. Existing rows were written live: false is right for them.
--
-- Re-running is harmless. Owner: Shawn. 11 Nov 2026.
-- =============================================================================

ALTER TABLE conversation_message
  ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;
