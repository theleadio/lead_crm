-- =============================================================================
-- LEAD CRM — migration 024
-- Browser roles off the tables migration 019 made.
--
-- 019 (the inbox and enquiry teams) created eight tables without revoking
-- Supabase's `anon` and `authenticated` roles, so with the public anon key
-- they were readable through the REST API, conversation_message (customer
-- WhatsApp text) among them. Neither app reads them that way: both use the
-- server's direct database connection. Every other table is already closed
-- (RLS, or REVOKE as in 014 and 023).
--
-- The views consent_current and payment_net (001/009) are closed too: owned
-- by postgres and not security_invoker, they read their tables with the
-- owner's rights, past the RLS on consent and payment, and anon could
-- select them.
--
-- Applied to production by hand on 12 Nov 2026, the day it was found.
-- Re-running is harmless; a database without these roles skips it.
-- Rollback (don't): GRANT the privileges back to anon / authenticated.
-- =============================================================================

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['conversation', 'conversation_message',
                               'enquiry_category', 'enquiry_event',
                               'enquiry_rule', 'holiday', 'team',
                               'team_member', 'consent_current',
                               'payment_net'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
