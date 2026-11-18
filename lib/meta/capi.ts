import { graphVersion } from "../ads/meta.ts";
import { paidBetweenSql } from "../reports/ads.ts";
import { db } from "../sql.ts";

// Meta Conversions API for click-to-WhatsApp ads: tells Meta which WhatsApp
// conversations became an opt-in and which became a sale, so its delivery
// optimises on those instead of on "a message was sent".
//
//   LeadSubmitted  a person's first `ctwa` touchpoint (the opt-in), with its
//                  click id (lib/import/wati-ctwa.ts).
//   Purchase       one per ORDER (an enrolment or deal's instalments, or a
//                  SalesProcess order), valued at the order's net MYR across
//                  all its payments: the same orders and money as the ads
//                  report's ROAS (`paidBetweenSql`, lib/reports/ads.ts). It
//                  carries the click id of the person's latest click within
//                  CLICK_WINDOW_DAYS before the order's first payment. An
//                  instalment paid after the Purchase went out is not sent
//                  again (Meta drops a repeated event_id).
//
// Business-messaging events identify the person by the WhatsApp click id and
// the WhatsApp Business Account only: no phone, no email is sent (PDPA). Meta
// takes events up to 7 days old, so only that window is scanned.
//
// Each event is recorded in integration_event (source 'meta_capi') before it
// is sent, keyed `lead:<touchpoint id>` or `purchase:<order key>`: a re-run
// sends nothing twice. The event_id is the same key, so Meta also drops a
// repeat on its side. A run first CLAIMS the rows it will send (one statement),
// so two runs at once never send the same event.
//
// A refused request is split in halves until the events Meta refuses on their
// own are found, so one bad event never costs its batch. A try counts against
// an event (MAX_ATTEMPTS, then `ignored`) only when Meta took other events in
// the same run: if nothing at all got through, or Meta was unreachable, the
// cause is setup (dataset link, token) or Meta's side, and no try is used up.
// Test sends keep their own ledger (`meta_capi_test`), so a test run never
// marks a conversion as sent for the live run that follows.

export const SOURCE = "meta_capi";
export const TEST_SOURCE = "meta_capi_test";
export const ledgerOf = (cfg: Pick<CapiConfig, "testEventCode">) =>
  cfg.testEventCode ? TEST_SOURCE : SOURCE;
export const WINDOW_DAYS = 7;
// How long before an order's first payment a click may be and still get the
// credit. Check against Meta's current documentation for click ids.
export const CLICK_WINDOW_DAYS = 7;
export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [300, 1800, 7200, 21600];

export type Conversion = {
  key: string; // lead:<id> | purchase:<id>
  eventName: "LeadSubmitted" | "Purchase";
  at: Date;
  ctwaClid: string;
  valueMyr: string | null;
};

export type CapiConfig = {
  datasetId: string;
  token: string;
  wabaId: string;
  testEventCode: string | null;
  // META_GRAPH_VERSION, as the ads sync reads it; unset = its default.
  graphVersion?: string;
};

// The event as Meta's /events endpoint takes it (business messaging).
export function toMetaEvent(c: Conversion, wabaId: string) {
  return {
    event_name: c.eventName,
    event_time: Math.floor(c.at.getTime() / 1000),
    event_id: c.key,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { whatsapp_business_account_id: wabaId, ctwa_clid: c.ctwaClid },
    ...(c.valueMyr !== null
      ? { custom_data: { currency: "MYR", value: Number(c.valueMyr) } }
      : {}),
  };
}

export function configFromEnv(
  env: Record<string, string | undefined>,
  live: boolean,
): CapiConfig | string {
  const missing = ["META_DATASET_ID", "META_CAPI_TOKEN", "META_WABA_ID"].filter(
    (k) => !env[k],
  );
  if (missing.length) return `not set: ${missing.join(", ")}`;
  return {
    datasetId: env.META_DATASET_ID!,
    token: env.META_CAPI_TOKEN!,
    wabaId: env.META_WABA_ID!,
    // Test events show in Events Manager > Test events and train nothing.
    testEventCode: live ? null : (env.META_TEST_EVENT_CODE ?? null),
    graphVersion: graphVersion(env),
  };
}

// Conversions in the window not yet sent (or due a retry).
export async function dueConversions(
  now = new Date(),
  source: string = SOURCE,
): Promise<Conversion[]> {
  const sql = db();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await sql`
    WITH clicks AS (
      SELECT t.id, t.person_id, t.occurred_at, t.ctwa_clid,
             row_number() OVER (PARTITION BY t.person_id
                                ORDER BY t.occurred_at, t.id) AS nth
      FROM touchpoint t
      JOIN person p ON p.id = t.person_id
      WHERE t.channel = 'ctwa' AND t.ctwa_clid IS NOT NULL
        AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
    ),
    leads AS (
      SELECT 'lead:' || c.id AS key, 'LeadSubmitted' AS event_name,
             c.occurred_at AS at, c.ctwa_clid, NULL::text AS value
      FROM clicks c
      WHERE c.nth = 1 AND c.occurred_at >= ${since}
        -- A person already told about another click of theirs (a merge can
        -- bring an earlier click under them) is not told a second time.
        AND NOT EXISTS (
          SELECT 1 FROM clicks c2
          JOIN integration_event ie2
            ON ie2.source = ${source} AND ie2.external_event_id = 'lead:' || c2.id
          WHERE c2.person_id = c.person_id AND c2.id <> c.id)
    ),
    -- Every payment ever, so an order's value is all of it; only orders whose
    -- first payment is in the window are sent.
    ${paidBetweenSql(
      sql,
      sql`'-infinity'::timestamptz`,
      sql`${now}::timestamptz + interval '1 day'`,
    )},
    orders AS (
      SELECT p.order_key, p.person_id, min(p.paid_at) AS first_paid,
             sum(p.net) AS net
      FROM paid p
      WHERE p.person_id IS NOT NULL
      GROUP BY p.order_key, p.person_id
    ),
    purchases AS (
      SELECT DISTINCT ON (o.order_key)
             'purchase:' || o.order_key AS key, 'Purchase' AS event_name,
             o.first_paid AS at, c.ctwa_clid, o.net::text AS value
      FROM orders o
      JOIN clicks c ON c.person_id = o.person_id
                   AND c.occurred_at <= o.first_paid
                   AND c.occurred_at >= o.first_paid
                                        - make_interval(days => ${CLICK_WINDOW_DAYS})
      WHERE o.net > 0 AND o.first_paid >= ${since}
      ORDER BY o.order_key, c.occurred_at DESC
    ),
    todo AS (SELECT * FROM leads UNION ALL SELECT * FROM purchases)
    SELECT t.* FROM todo t
    LEFT JOIN integration_event ie
      ON ie.source = ${source} AND ie.external_event_id = t.key
    WHERE ie.id IS NULL
       OR (ie.status = 'failed' AND ie.attempts < ${MAX_ATTEMPTS}
           AND coalesce(ie.next_attempt_at, now()) <= now())
       -- Claimed but never marked: a run that died mid-send.
       OR (ie.status = 'received' AND ie.updated_at < now() - interval '10 minutes')
    ORDER BY t.at`;
  return rows.map((r) => ({
    key: r.key,
    eventName: r.event_name,
    at: new Date(r.at),
    ctwaClid: r.ctwa_clid,
    valueMyr: r.value,
  }));
}

export type SendResult = {
  sent: number;
  // Not sent, will be tried again next run.
  failed: number;
  // Refused on their own too often: `ignored`, not tried again.
  gaveUp: number;
  // Another run had already taken them.
  skipped: number;
  error?: string;
};

// Records the rows this run will send, in one statement, and returns the keys
// it won. A row already sent, or being sent by another run, or waiting out a
// backoff, is not returned: this run leaves it alone.
async function claim(list: Conversion[], source: string): Promise<Set<string>> {
  const sql = db();
  const payloads = list.map((c) =>
    JSON.stringify({
      eventName: c.eventName,
      at: c.at.toISOString(),
      test: source === TEST_SOURCE,
    }),
  );
  const rows = await sql`
    INSERT INTO integration_event (source, external_event_id, payload)
    SELECT ${source}, t.k, t.p::jsonb
    FROM unnest(${list.map((c) => c.key)}::text[], ${payloads}::text[]) AS t(k, p)
    ON CONFLICT (source, external_event_id) DO UPDATE
      SET status = 'received', updated_at = now()
      WHERE (integration_event.status = 'failed'
             AND coalesce(integration_event.next_attempt_at, now()) <= now())
         OR (integration_event.status = 'received'
             AND integration_event.updated_at < now() - interval '10 minutes')
    RETURNING external_event_id`;
  return new Set(rows.map((r) => r.external_event_id as string));
}

type Posted =
  | { ok: true }
  // `refused`: Meta answered 4xx, so something in what we sent is wrong; worth
  // splitting. Otherwise (5xx, rate limit, no answer) it is Meta's side or the
  // network, and splitting would only repeat the same failure.
  | { ok: false; error: string; refused: boolean };

async function post(
  list: Conversion[],
  cfg: CapiConfig,
  fetchImpl: typeof fetch,
): Promise<Posted> {
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${cfg.graphVersion ?? graphVersion({})}/${cfg.datasetId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: list.map((c) => toMetaEvent(c, cfg.wabaId)),
          access_token: cfg.token,
          ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}),
        }),
      },
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return {
      ok: false,
      error: `HTTP ${res.status}: ${body?.error?.message ?? "no detail"}`.slice(
        0,
        500,
      ),
      refused:
        res.status >= 400 &&
        res.status < 500 &&
        ![408, 429].includes(res.status),
    };
  } catch (err) {
    return {
      ok: false,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      refused: false,
    };
  }
}

// Sends what this run can claim (Meta takes up to 1,000 per request).
export async function sendConversions(
  list: Conversion[],
  cfg: CapiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, gaveUp: 0, skipped: 0 };
  if (!list.length) return result;
  const sql = db();
  const source = ledgerOf(cfg);
  const claimed = await claim(list, source);
  const mine = list.filter((c) => claimed.has(c.key));
  result.skipped = list.length - mine.length;
  if (!mine.length) return result;

  const accepted: string[] = [];
  const refused = new Map<string, string>(); // refused on its own
  const undecided: string[] = []; // never got a clear answer
  let stop = false;

  async function attempt(batch: Conversion[]): Promise<void> {
    const keys = batch.map((c) => c.key);
    if (stop) return void undecided.push(...keys);
    const r = await post(batch, cfg, fetchImpl);
    if (r.ok) return void accepted.push(...keys);
    result.error = r.error;
    if (!r.refused) {
      stop = true;
      return void undecided.push(...keys);
    }
    if (batch.length === 1) {
      refused.set(batch[0].key, r.error);
      // Three refused on their own and nothing accepted: setup, not events.
      if (!accepted.length && refused.size >= 3) stop = true;
      return;
    }
    const mid = Math.ceil(batch.length / 2);
    await attempt(batch.slice(0, mid));
    await attempt(batch.slice(mid));
  }
  await attempt(mine);

  if (accepted.length)
    await sql`
      UPDATE integration_event
      SET status = 'processed', processed_at = now(), error = NULL,
          attempts = attempts + 1, updated_at = now()
      WHERE source = ${source} AND external_event_id = ANY(${accepted})`;
  result.sent = accepted.length;

  // If nothing got through, the refusals are the setup's fault, not the
  // events': no try is used up, and the events stay due.
  const countTries = accepted.length > 0;
  const wait = sql`now() + make_interval(secs =>
    (${BACKOFF_SECONDS}::int[])[least(attempts + 1, ${BACKOFF_SECONDS.length})])`;
  for (const [key, error] of refused) {
    const [row] = await sql`
      UPDATE integration_event
      SET attempts = attempts + ${countTries ? 1 : 0}, error = ${error},
          processed_at = now(), updated_at = now(),
          status = CASE WHEN ${countTries} AND attempts + 1 >= ${MAX_ATTEMPTS}
                        THEN 'ignored' ELSE 'failed' END,
          next_attempt_at = ${wait}
      WHERE source = ${source} AND external_event_id = ${key}
      RETURNING status`;
    if (row?.status === "ignored") result.gaveUp++;
    else result.failed++;
  }
  if (undecided.length) {
    await sql`
      UPDATE integration_event
      SET status = 'failed', error = ${result.error ?? "no answer"},
          processed_at = now(), updated_at = now(), next_attempt_at = ${wait}
      WHERE source = ${source} AND external_event_id = ANY(${undecided})`;
    result.failed += undecided.length;
  }
  return result;
}

// `--retry-failed`: events that used their tries (`ignored`) or are waiting out
// a backoff are made due again, once the cause is fixed. Only the window's:
// older events are too old for Meta anyway.
export async function retryFailed(
  source: string = SOURCE,
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await db()`
    UPDATE integration_event
    SET status = 'failed', attempts = 0, next_attempt_at = now(), updated_at = now()
    WHERE source = ${source} AND status IN ('failed', 'ignored')
      AND received_at >= ${since}
    RETURNING id`;
  return rows.length;
}

// How many events gave up in the window, for the run's summary.
export async function gaveUpCount(
  source: string = SOURCE,
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const [r] = await db()`
    SELECT count(*)::int AS n FROM integration_event
    WHERE source = ${source} AND status = 'ignored' AND received_at >= ${since}`;
  return r.n as number;
}
