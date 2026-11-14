import { db } from "../sql.ts";

// Meta Conversions API for click-to-WhatsApp ads: tells Meta which WhatsApp
// conversations became an opt-in and which became a sale, so its delivery
// optimises on those instead of on "a message was sent".
//
//   LeadSubmitted  a person's first `ctwa` touchpoint (the opt-in), with its
//                  click id (lib/import/wati-ctwa.ts).
//   Purchase       a succeeded payment (CRM `payment` or SalesProcess) from a
//                  person whose latest click id came before it; net MYR.
//
// Business-messaging events identify the person by the WhatsApp click id and
// the WhatsApp Business Account only: no phone, no email is sent (PDPA). Meta
// takes events up to 7 days old, so only that window is scanned.
//
// Each event is recorded in integration_event (source 'meta_capi') before it
// is sent, keyed `lead:<touchpoint id>` or `purchase:<order key>`: a re-run
// sends nothing twice, and a failure is retried with the usual backoff. The
// event_id is the same key, so Meta also drops a repeat on its side.
// Test sends keep their own ledger (`meta_capi_test`), so a test run never
// marks a conversion as sent for the live run that follows.

export const SOURCE = "meta_capi";
export const TEST_SOURCE = "meta_capi_test";
export const ledgerOf = (cfg: Pick<CapiConfig, "testEventCode">) =>
  cfg.testEventCode ? TEST_SOURCE : SOURCE;
export const WINDOW_DAYS = 7;
export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [300, 1800, 7200, 21600];
const GRAPH = "https://graph.facebook.com/v21.0";

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
      SELECT 'lead:' || id AS key, 'LeadSubmitted' AS event_name,
             occurred_at AS at, ctwa_clid, NULL::text AS value
      FROM clicks
      WHERE nth = 1 AND occurred_at >= ${since}
    ),
    paid AS (
      -- CRM payments: buyer is the enrolment's person, else the deal's.
      SELECT 'crm:' || pn.id AS order_key, coalesce(e.person_id, d.person_id) AS person_id,
             pn.paid_at, pn.net_myr AS net
      FROM payment_net pn
      LEFT JOIN enrolment e ON e.id = pn.enrolment_id
      LEFT JOIN deal d ON d.id = pn.deal_id
      WHERE pn.status IN ('succeeded', 'partially_refunded')
        AND pn.paid_at >= ${since}
      UNION ALL
      -- SalesProcess orders, through the import touchpoint (as the ads report).
      (SELECT DISTINCT ON (coalesce(sp.order_id, sp.id))
              'sp:' || coalesce(sp.order_id, sp.id), b.person_id, sp.paid_at,
              sp.amount_myr - sp.refunded_myr
       FROM salesprocess_payment sp
       JOIN touchpoint b ON b.channel = 'import'
                        AND b.external_ref = 'ghl:' || sp.ghl_contact_id
       WHERE sp.live_mode AND sp.currency = 'MYR'
         AND sp.status IN ('succeeded', 'partially_refunded')
         AND sp.paid_at >= ${since}
       ORDER BY coalesce(sp.order_id, sp.id), sp.paid_at)
    ),
    purchases AS (
      SELECT DISTINCT ON (p.order_key)
             'purchase:' || p.order_key AS key, 'Purchase' AS event_name,
             p.paid_at AS at, c.ctwa_clid, p.net::text AS value
      FROM paid p
      JOIN clicks c ON c.person_id = p.person_id AND c.occurred_at <= p.paid_at
      WHERE p.net > 0
      ORDER BY p.order_key, c.occurred_at DESC
    ),
    todo AS (SELECT * FROM leads UNION ALL SELECT * FROM purchases)
    SELECT t.* FROM todo t
    LEFT JOIN integration_event ie
      ON ie.source = ${source} AND ie.external_event_id = t.key
    WHERE ie.id IS NULL
       OR (ie.status = 'failed' AND ie.attempts < ${MAX_ATTEMPTS}
           AND ie.next_attempt_at <= now())
       -- Recorded but never marked: a run that died mid-send.
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

export type SendResult = { sent: number; failed: number; error?: string };

// One batch (Meta takes up to 1,000). Recorded first, then sent, then marked:
// a crash between the two leaves rows `received`, which the next run retries.
export async function sendConversions(
  list: Conversion[],
  cfg: CapiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!list.length) return { sent: 0, failed: 0 };
  const sql = db();
  const source = ledgerOf(cfg);
  const keys = list.map((c) => c.key);
  for (const c of list)
    await sql`
      INSERT INTO integration_event (source, external_event_id, payload)
      VALUES (${source}, ${c.key},
              ${sql.json({ eventName: c.eventName, at: c.at.toISOString(), test: cfg.testEventCode !== null } as never)})
      ON CONFLICT (source, external_event_id) DO NOTHING`;

  let error: string | null = null;
  try {
    const res = await fetchImpl(`${GRAPH}/${cfg.datasetId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: list.map((c) => toMetaEvent(c, cfg.wabaId)),
        access_token: cfg.token,
        ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      error = `HTTP ${res.status}: ${body?.error?.message ?? "no detail"}`.slice(0, 500);
    }
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  if (error === null) {
    await sql`
      UPDATE integration_event
      SET status = 'processed', processed_at = now(), error = NULL,
          attempts = attempts + 1, updated_at = now()
      WHERE source = ${source} AND external_event_id = ANY(${keys})`;
    return { sent: list.length, failed: 0 };
  }
  await sql`
    UPDATE integration_event
    SET status = 'failed', processed_at = now(), error = ${error},
        attempts = attempts + 1,
        next_attempt_at = now() + make_interval(secs =>
          (${BACKOFF_SECONDS}::int[])[least(attempts + 1, ${BACKOFF_SECONDS.length})]),
        updated_at = now()
    WHERE source = ${source} AND external_event_id = ANY(${keys})`;
  return { sent: 0, failed: list.length, error };
}
