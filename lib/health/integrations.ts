import { permissionFor, type Viewer } from "../auth/permissions.ts";
import { retryDeadEvents } from "../events/drain.ts";
import { db } from "../sql.ts";

// Spec §11.4: GET /api/health/integrations, and the Retry the Settings panel
// posts. One row per integration: name, lastSuccessAt, lastErrorAt,
// lastErrorMessage, queueDepth, status (ok / degraded / down).
//
// Every figure is read from data the integration already writes, so a broken
// job shows here without the job having to report anything:
//   outbox            event_outbox, except LMS notices
//   lms_notices       event_outbox rows of type LmsNotice (CRM → LMS, PR #43;
//                     empty, and so ok, until the hand-off is switched on)
//   stripe_webhook    integration_event, source 'stripe' (PR #41)
//   meta_ads_sync     meta_ad_insight.synced_at (daily-sync.yml)
//   salesprocess_sync salesprocess_payment.synced_at (daily-sync.yml)
// Not covered: the LMS → CRM read sync and the GHL contact import write no
// run timestamp anywhere, so their health can't be read honestly yet.
//
// Thresholds are decisions, not facts; change them here.
const OUTBOX_STUCK_MINUTES = 15; // a due row older than this means the drain isn't running
const DAILY_SYNC_DEGRADED_HOURS = 26; // one missed 03:00 MYT run, plus slack
const DAILY_SYNC_DOWN_HOURS = 50; // two missed runs
const STRIPE_FAILED_DOWN_HOURS = 24; // Stripe keeps retrying; a day of failure is down

export type HealthStatus = "ok" | "degraded" | "down";

export type IntegrationHealth = {
  key: string;
  name: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  queueDepth: number;
  status: HealthStatus;
  // Dead outbox rows the Retry button can revive; empty for the others.
  retryable: { id: string; type: string; lastError: string | null }[];
};

export function canSeeIntegrations(viewer: Viewer): boolean {
  return permissionFor(viewer, "settings", "read").allowed;
}
export function canRetryIntegrations(viewer: Viewer): boolean {
  return permissionFor(viewer, "settings", "write").allowed;
}

const iso = (v: unknown): string | null =>
  v ? new Date(v as string).toISOString() : null;

async function outboxHealth(
  key: string,
  name: string,
  lmsOnly: boolean,
): Promise<IntegrationHealth> {
  const sql = db();
  const match = lmsOnly ? sql`type = 'LmsNotice'` : sql`type <> 'LmsNotice'`;
  const [s] = await sql`
    SELECT
      max(processed_at) AS last_success,
      max(updated_at) FILTER (WHERE last_error IS NOT NULL) AS last_error_at,
      count(*) FILTER (WHERE processed_at IS NULL)::int AS queue,
      count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead,
      count(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
                         AND attempts > 0)::int AS retrying,
      count(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
                         AND next_attempt_at < now() - make_interval(mins => ${OUTBOX_STUCK_MINUTES})
                      )::int AS stuck
    FROM event_outbox WHERE ${match}`;
  const [last] = await sql`
    SELECT last_error FROM event_outbox
    WHERE ${match} AND last_error IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1`;
  const dead = await sql`
    SELECT id, type, last_error FROM event_outbox
    WHERE ${match} AND dead_at IS NOT NULL
    ORDER BY dead_at DESC LIMIT 50`;
  const status: HealthStatus =
    s.dead > 0 ? "down" : s.retrying > 0 || s.stuck > 0 ? "degraded" : "ok";
  return {
    key,
    name,
    lastSuccessAt: iso(s.last_success),
    lastErrorAt: iso(s.last_error_at),
    lastErrorMessage: (last?.last_error as string | undefined) ?? null,
    queueDepth: s.queue,
    status,
    retryable: dead.map((d) => ({
      id: d.id as string,
      type: d.type as string,
      lastError: (d.last_error as string | null) ?? null,
    })),
  };
}

async function stripeHealth(): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT
      max(processed_at) FILTER (WHERE status IN ('processed','ignored')) AS last_success,
      max(processed_at) FILTER (WHERE status = 'failed') AS last_error_at,
      count(*) FILTER (WHERE status IN ('received','failed'))::int AS queue,
      count(*) FILTER (WHERE status = 'failed'
                         AND received_at < now() - make_interval(hours => ${STRIPE_FAILED_DOWN_HOURS})
                      )::int AS old_failed,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM integration_event WHERE source = 'stripe'`;
  const [last] = await sql`
    SELECT error FROM integration_event
    WHERE source = 'stripe' AND status = 'failed'
    ORDER BY processed_at DESC NULLS LAST LIMIT 1`;
  return {
    key: "stripe_webhook",
    name: "Stripe payments (webhook)",
    lastSuccessAt: iso(s.last_success),
    lastErrorAt: iso(s.last_error_at),
    lastErrorMessage: (last?.error as string | undefined) ?? null,
    queueDepth: s.queue,
    status: s.old_failed > 0 ? "down" : s.failed > 0 ? "degraded" : "ok",
    // Stripe redelivers failed events itself; nothing to revive here.
    retryable: [],
  };
}

async function dailySyncHealth(
  key: string,
  name: string,
  table: "meta_ad_insight" | "salesprocess_payment",
): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT max(synced_at) AS last,
           extract(epoch FROM now() - max(synced_at)) / 3600 AS hours
    FROM ${sql(table)}`;
  const hours = s.hours === null ? null : Number(s.hours);
  const status: HealthStatus =
    hours === null || hours > DAILY_SYNC_DOWN_HOURS
      ? "down"
      : hours > DAILY_SYNC_DEGRADED_HOURS
        ? "degraded"
        : "ok";
  return {
    key,
    name,
    lastSuccessAt: iso(s.last),
    lastErrorAt: null,
    // The job's own errors are in the GitHub Actions log, not the database.
    lastErrorMessage:
      hours === null
        ? "Never synced"
        : status === "ok"
          ? null
          : `Last synced ${Math.floor(hours)} hours ago; check the daily-sync workflow run`,
    queueDepth: 0,
    status,
    retryable: [],
  };
}

export async function integrationHealth(): Promise<IntegrationHealth[]> {
  return [
    await outboxHealth("outbox", "Event outbox (workers)", false),
    await outboxHealth("lms_notices", "LMS notices (CRM → LMS)", true),
    await stripeHealth(),
    await dailySyncHealth("meta_ads_sync", "Meta ads sync", "meta_ad_insight"),
    await dailySyncHealth(
      "salesprocess_sync",
      "SalesProcess payments sync",
      "salesprocess_payment",
    ),
  ];
}

// The Retry button: revive dead outbox rows, all of an integration's or the
// ids given. Only outbox-based integrations have dead rows to revive.
export async function retryIntegration(input: {
  integration: "outbox" | "lms_notices";
  ids?: string[];
}): Promise<number> {
  const sql = db();
  const match =
    input.integration === "lms_notices"
      ? sql`type = 'LmsNotice'`
      : sql`type <> 'LmsNotice'`;
  const rows = input.ids
    ? await sql`
        SELECT id FROM event_outbox
        WHERE ${match} AND dead_at IS NOT NULL AND id = ANY(${input.ids}::uuid[])`
    : await sql`
        SELECT id FROM event_outbox WHERE ${match} AND dead_at IS NOT NULL`;
  if (!rows.length) return 0;
  return retryDeadEvents(rows.map((r) => r.id as string));
}
