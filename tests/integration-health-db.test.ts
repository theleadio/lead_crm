// Spec §11.4 integration health, against the database. Each test empties the
// tables it reads first (inside its rolled-back transaction), so it judges
// only the rows it seeds.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  canRetryIntegrations,
  canSeeIntegrations,
  integrationHealth,
  retryIntegration,
  type IntegrationHealth,
} from "../lib/health/integrations.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

async function clean() {
  const sql = db();
  await sql`DELETE FROM event_outbox`;
  await sql`DELETE FROM integration_event WHERE source = 'stripe'`;
  await sql`DELETE FROM meta_ad_insight`;
  await sql`DELETE FROM salesprocess_payment`;
}

const byKey = async (key: string): Promise<IntegrationHealth> =>
  (await integrationHealth()).find((h) => h.key === key)!;

async function outboxRow(
  type: string,
  state: "done" | "due" | "retrying" | "stuck" | "dead",
  error: string | null = null,
): Promise<string> {
  const sql = db();
  const [r] = await sql`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                              processed_at, attempts, last_error,
                              next_attempt_at, dead_at)
    VALUES (${type}, 'x', gen_random_uuid(), '{}',
            ${state === "done" ? sql`now()` : sql`NULL`},
            ${state === "retrying" || state === "dead" ? 5 : 0},
            ${error},
            ${state === "stuck" ? sql`now() - interval '1 hour'` : sql`now()`},
            ${state === "dead" ? sql`now()` : sql`NULL`})
    RETURNING id`;
  return r.id as string;
}

it("an empty system is ok everywhere it can be, and the syncs say never synced", async () => {
  await clean();
  const all = await integrationHealth();
  assert.deepEqual(
    all.map((h) => [h.key, h.status]),
    [
      ["outbox", "ok"],
      ["lms_notices", "ok"],
      ["stripe_webhook", "ok"],
      ["meta_ads_sync", "down"],
      ["salesprocess_sync", "down"],
    ],
  );
  assert.equal((await byKey("meta_ads_sync")).lastErrorMessage, "Never synced");
});

it("outbox: processed rows are ok; a retrying row is degraded; a dead row is down and retryable", async () => {
  await clean();
  await outboxRow("PaymentRecorded", "done");
  assert.equal((await byKey("outbox")).status, "ok");

  await outboxRow("EnrolmentCancelled", "retrying", "boom");
  let h = await byKey("outbox");
  assert.equal(h.status, "degraded");
  assert.equal(h.queueDepth, 1);
  assert.equal(h.lastErrorMessage, "boom");

  const dead = await outboxRow("ClassCancelled", "dead", "gave up");
  h = await byKey("outbox");
  assert.equal(h.status, "down");
  assert.deepEqual(
    h.retryable.map((r) => r.id),
    [dead],
  );
});

it("outbox: a due row nobody drained for 15 minutes is degraded (the drain isn't running)", async () => {
  await clean();
  await outboxRow("EnrolmentConfirmed", "stuck");
  assert.equal((await byKey("outbox")).status, "degraded");
});

it("LMS notices are reported apart from the rest of the outbox", async () => {
  await clean();
  await outboxRow(
    "LmsNotice",
    "dead",
    "LMS answered 503 to enrolment.confirmed",
  );
  assert.equal((await byKey("lms_notices")).status, "down");
  assert.equal((await byKey("outbox")).status, "ok");
});

it("retry revives only that integration's dead rows, or only the ids given", async () => {
  await clean();
  const lms1 = await outboxRow("LmsNotice", "dead");
  const lms2 = await outboxRow("LmsNotice", "dead");
  const other = await outboxRow("ClassCancelled", "dead");

  assert.equal(
    await retryIntegration({ integration: "lms_notices", ids: [lms1] }),
    1,
  );
  assert.equal(
    await retryIntegration({ integration: "lms_notices", ids: [other] }),
    0,
  );
  assert.equal(await retryIntegration({ integration: "lms_notices" }), 1);

  const rows = await db()`
    SELECT id, dead_at FROM event_outbox WHERE id IN (${lms1}, ${lms2}, ${other})`;
  const deadNow = rows.filter((r) => r.dead_at).map((r) => r.id);
  assert.deepEqual(deadNow, [other]);
});

it("stripe: a failed event is degraded, and down once it has failed for a day", async () => {
  await clean();
  const sql = db();
  await sql`
    INSERT INTO integration_event (source, external_event_id, payload, status, processed_at)
    VALUES ('stripe', 'evt_ok', '{}', 'processed', now())`;
  assert.equal((await byKey("stripe_webhook")).status, "ok");

  await sql`
    INSERT INTO integration_event (source, external_event_id, payload, status, processed_at, error)
    VALUES ('stripe', 'evt_bad', '{}', 'failed', now(), 'currency usd is not MYR (§4)')`;
  let h = await byKey("stripe_webhook");
  assert.equal(h.status, "degraded");
  assert.match(h.lastErrorMessage!, /not MYR/);

  await sql`UPDATE integration_event SET received_at = now() - interval '25 hours'
            WHERE external_event_id = 'evt_bad'`;
  h = await byKey("stripe_webhook");
  assert.equal(h.status, "down");
});

it("daily syncs: fresh is ok, a missed run is degraded, two missed runs are down", async () => {
  await clean();
  const sql = db();
  const seed = (hoursAgo: number) => sql`
    INSERT INTO salesprocess_payment (id, ghl_contact_id, status, amount_myr,
                                      currency, live_mode, paid_at, synced_at)
    VALUES (${crypto.randomUUID()}, 'c', 'succeeded', 100, 'MYR', true, now(),
            now() - make_interval(hours => ${hoursAgo}))`;
  await seed(60);
  assert.equal((await byKey("salesprocess_sync")).status, "down");
  await seed(30);
  assert.equal((await byKey("salesprocess_sync")).status, "degraded");
  await seed(1);
  const h = await byKey("salesprocess_sync");
  assert.equal(h.status, "ok");
  assert.equal(h.lastErrorMessage, null);
});

it("only super_admin sees or retries integrations (§6 settings)", async () => {
  assert.equal(canSeeIntegrations(await newUser("super_admin")), true);
  assert.equal(canRetryIntegrations(await newUser("super_admin")), true);
  for (const role of [
    "management",
    "operations",
    "sales",
    "support",
  ] as const) {
    assert.equal(canSeeIntegrations(await newUser(role)), false, role);
    assert.equal(canRetryIntegrations(await newUser(role)), false, role);
  }
});
