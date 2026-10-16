-- =============================================================================
-- LEAD CRM — migration 012
-- Rate-limit counter for the public intake API (spec §8.2 step 1: 10 requests
-- per IP per minute). Shawn-only plumbing for lib/public/rate-limit.ts.
--
-- Why a table: an in-memory counter does not survive serverless or more than
-- one instance, and hosting is not decided (§2). If the host later gets an edge
-- limiter (Vercel firewall, Cloudflare, a load balancer) this table can be
-- dropped; the app-side check is then a second line, not the only one (O40).
--
-- One row per (bucket, fixed window). The bucket is an HMAC of the IP keyed with
-- the server-only RATE_LIMIT_SECRET (not the website's API key), never the
-- address itself (PDPA). The route writes no IP to audit_log either. A fixed
-- window lets a caller send up to twice the limit across a window boundary;
-- that is accepted for a spam brake.
-- UNLOGGED: counters may be lost after a crash, which only resets a limit.
-- Rows older than an hour are deleted by the next call (no job needed).
--
-- The 3-per-phone-per-hour limit needs no table: it counts the person's
-- web_form touchpoints from the last hour (touchpoint_person_time_idx).
--
-- Re-running is harmless. Owner: Shawn. 9 Oct 2026.
-- =============================================================================

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_hit (
  bucket        text        NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_hit_window_idx ON rate_limit_hit (window_start);

-- Counts one hit in the bucket's current window and returns the total so far
-- (including this one). Atomic under concurrency. Use one window length per
-- bucket name: the length is not part of the key.
CREATE OR REPLACE FUNCTION rate_limit_take(p_bucket text, p_window_seconds integer)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_window timestamptz;
  v_hits   integer;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'rate_limit_take: window must be at least 1 second';
  END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  DELETE FROM rate_limit_hit WHERE window_start < now() - interval '1 hour';

  INSERT INTO rate_limit_hit AS r (bucket, window_start) VALUES (p_bucket, v_window)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;
  RETURN v_hits;
END $$;

REVOKE EXECUTE ON FUNCTION rate_limit_take(text, integer) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION rate_limit_take(text, integer) FROM %I', r);
      EXECUTE format('REVOKE ALL ON rate_limit_hit FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
