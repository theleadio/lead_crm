// Meta Conversions API (lib/meta/capi.ts): which conversions are due, the
// event Meta gets, and the send ledger. Meta's endpoint is a stub: nothing
// leaves the machine. Each DB test rolls back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { saveCtwaTouch } from "../lib/import/wati-ctwa.ts";
import {
  MAX_ATTEMPTS,
  configFromEnv,
  dueConversions,
  retryFailed,
  sendConversions,
  TEST_SOURCE,
  toMetaEvent,
  type CapiConfig,
  type Conversion,
} from "../lib/meta/capi.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newUser, pay } from "./seed.ts";

after(closeDb);

const CFG: CapiConfig = {
  datasetId: "dataset-test-1",
  token: "test-token",
  wabaId: "waba-1",
  testEventCode: "TEST123",
};

test("the event: business messaging, click id and WABA only, value in MYR", () => {
  const at = new Date("2026-11-11T04:00:00Z");
  assert.deepEqual(
    toMetaEvent(
      {
        key: "purchase:crm:1",
        eventName: "Purchase",
        at,
        ctwaClid: "clid",
        valueMyr: "680.00",
      },
      "waba-1",
    ),
    {
      event_name: "Purchase",
      event_time: 1794369600,
      event_id: "purchase:crm:1",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { whatsapp_business_account_id: "waba-1", ctwa_clid: "clid" },
      custom_data: { currency: "MYR", value: 680 },
    },
  );
  const lead = toMetaEvent(
    {
      key: "lead:x",
      eventName: "LeadSubmitted",
      at,
      ctwaClid: "c",
      valueMyr: null,
    },
    "w",
  );
  assert.equal("custom_data" in lead, false);
});

test("config: all three ids needed; test code dropped only with --live", () => {
  assert.equal(
    configFromEnv({}, false),
    "not set: META_DATASET_ID, META_CAPI_TOKEN, META_WABA_ID",
  );
  const env = {
    META_DATASET_ID: "d",
    META_CAPI_TOKEN: "t",
    META_WABA_ID: "w",
    META_TEST_EVENT_CODE: "T1",
  };
  assert.equal((configFromEnv(env, false) as CapiConfig).testEventCode, "T1");
  assert.equal((configFromEnv(env, true) as CapiConfig).testEventCode, null);
  // The Graph version is the ads sync's: META_GRAPH_VERSION, else v23.0.
  assert.equal((configFromEnv(env, false) as CapiConfig).graphVersion, "v23.0");
  assert.equal(
    (
      configFromEnv(
        { ...env, META_GRAPH_VERSION: "v24.0" },
        false,
      ) as CapiConfig
    ).graphVersion,
    "v24.0",
  );
});

const wa = () =>
  `6011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const click = (clid: string) => ({
  adId: "52508930802001",
  ctwaClid: clid,
  headline: null,
  url: null,
});
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const mine = async (prefix: string) =>
  (await dueConversions()).filter((c) => c.key.startsWith(prefix));

type Call = { url: string; body: Record<string, unknown> };
function stub(status = 200) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(
      JSON.stringify(
        status === 200
          ? { events_received: 1 }
          : { error: { message: "Invalid parameter" } },
      ),
      { status },
    );
  }) as unknown as typeof fetch;
  return { f, calls };
}

it("an opt-in is due once; after a send it is not due again", async () => {
  const n = wa();
  const clid = `clid-${crypto.randomUUID()}`;
  const r = await saveCtwaTouch(n, "Ada", click(clid), hoursAgo(2));
  assert.equal(r.kind, "saved");
  const key = `lead:${r.kind === "saved" ? r.touchpointId : ""}`;
  const due = (await mine("lead:")).filter((c) => c.key === key);
  assert.equal(due.length, 1);
  assert.equal(due[0].ctwaClid, clid);

  const { f, calls } = stub();
  assert.deepEqual(await sendConversions(due, CFG, f), {
    sent: 1,
    failed: 0,
    gaveUp: 0,
    skipped: 0,
  });
  assert.equal(
    calls[0].url,
    "https://graph.facebook.com/v23.0/dataset-test-1/events",
  );
  assert.equal(calls[0].body.test_event_code, "TEST123");
  // No phone number anywhere in what Meta receives.
  assert.equal(JSON.stringify(calls[0].body).includes(n), false);
  assert.equal(
    (await dueConversions(new Date(), TEST_SOURCE)).some((c) => c.key === key),
    false,
  );
});

it("a later ad click by the same person is not a second opt-in", async () => {
  const n = wa();
  await saveCtwaTouch(n, "Ada", click(`a-${n}`), hoursAgo(5));
  await saveCtwaTouch(n, "Ada", click(`b-${n}`), hoursAgo(1));
  const due = (await mine("lead:")).filter((c) => c.ctwaClid.endsWith(n));
  assert.deepEqual(
    due.map((c) => c.ctwaClid),
    [`a-${n}`],
  );
});

it("an opt-in older than 7 days is not sent", async () => {
  const n = wa();
  await saveCtwaTouch(n, "Old", click(`old-${n}`), hoursAgo(24 * 8));
  assert.equal(
    (await mine("lead:")).some((c) => c.ctwaClid === `old-${n}`),
    false,
  );
});

it("a payment after an ad click is a Purchase with the net value", async () => {
  const n = wa();
  const t = await saveCtwaTouch(n, "Buyer", click(`p-${n}`), hoursAgo(3));
  assert.equal(t.kind, "saved");
  const [person] =
    await db()`SELECT id FROM person WHERE phone_e164 = ${`+${n}`}`;
  const cls = await newClass({ courseId: await newCourse() });
  const e = await enrol(cls, "confirmed", { personId: person.id });
  const paymentId = await pay(e, { amount: "680.00" });
  assert.ok(paymentId);
  const due = (await mine("purchase:")).filter(
    (c) => c.key === `purchase:crm:${e}`,
  );
  assert.equal(due.length, 1);
  assert.equal(due[0].ctwaClid, `p-${n}`);
  assert.equal(Number(due[0].valueMyr), 680);
});

it("a buyer with no ad click is not sent to Meta", async () => {
  const cls = await newClass({ courseId: await newCourse() });
  const e = await enrol(cls, "confirmed");
  await pay(e);
  assert.equal(
    (await mine("purchase:")).some((c) => c.key === `purchase:crm:${e}`),
    false,
  );
});

it("a refused send is marked failed and waits before it is due again; with nothing accepted it uses up no try", async () => {
  const n = wa();
  await saveCtwaTouch(n, "Ada", click(`f-${n}`), hoursAgo(1));
  const due = (await mine("lead:")).filter((c) => c.ctwaClid === `f-${n}`);
  const { f } = stub(400);
  const r = await sendConversions(due, CFG, f);
  assert.equal(r.failed, 1);
  assert.match(r.error ?? "", /HTTP 400: Invalid parameter/);
  const [row] = await db()`
    SELECT status, attempts, next_attempt_at > now() AS waiting
    FROM integration_event WHERE source = 'meta_capi_test' AND external_event_id = ${due[0].key}`;
  assert.deepEqual(
    { ...row },
    { status: "failed", attempts: 0, waiting: true },
  );
  assert.equal(
    (await dueConversions(new Date(), TEST_SOURCE)).some(
      (c) => c.ctwaClid === `f-${n}`,
    ),
    false,
  );
});

it("a test send does not count as sent for the live run", async () => {
  const n = wa();
  const clid = `t-${crypto.randomUUID()}`;
  await saveCtwaTouch(n, "Ada", click(clid), hoursAgo(1));
  const due = (await dueConversions(new Date(), TEST_SOURCE)).filter(
    (c) => c.ctwaClid === clid,
  );
  const { f } = stub();
  await sendConversions(due, CFG, f); // CFG carries a test code
  assert.equal(
    (await dueConversions(new Date(), TEST_SOURCE)).some(
      (c) => c.ctwaClid === clid,
    ),
    false,
  );
  assert.equal(
    (await mine("lead:")).some((c) => c.ctwaClid === clid),
    true,
  );
});

// ---- Batches, tries and claiming (review of #66, 11 Nov) ---------------------

type Seen = { ids: string[]; status: number };
// Meta, answering by what a request holds: `rule` gets the event ids and
// returns the HTTP status.
function meta(rule: (ids: string[]) => number) {
  const seen: Seen[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const ids = (
      JSON.parse(String(init.body)).data as { event_id: string }[]
    ).map((e) => e.event_id);
    const status = rule(ids);
    seen.push({ ids, status });
    return new Response(
      JSON.stringify(
        status === 200
          ? { events_received: ids.length }
          : { error: { message: "Invalid parameter" } },
      ),
      { status },
    );
  }) as unknown as typeof fetch;
  return { f, seen };
}

// n people with an opt-in each, found again by their click ids.
async function optIns(tag: string, n: number): Promise<Conversion[]> {
  for (let i = 0; i < n; i++)
    await saveCtwaTouch(
      wa(),
      `P${i}`,
      click(`${tag}-${i}`),
      hoursAgo(1 + i / 10),
    );
  return (await mine("lead:"))
    .filter((c) => c.ctwaClid.startsWith(`${tag}-`))
    .sort((a, b) => a.ctwaClid.localeCompare(b.ctwaClid));
}

const rowOf = async (key: string, source = TEST_SOURCE) =>
  (
    await db()`SELECT status, attempts FROM integration_event WHERE source = ${source} AND external_event_id = ${key}`
  )[0];

it("one refused event costs its batch nothing: the rest go through, the bad one is found", async () => {
  const due = await optIns(`bis-${crypto.randomUUID()}`, 5);
  const bad = due[2].key;
  const { f, seen } = meta((ids) => (ids.includes(bad) ? 400 : 200));
  const r = await sendConversions(due, CFG, f);
  assert.deepEqual([r.sent, r.failed, r.gaveUp], [4, 1, 0]);
  for (const c of due) {
    const row = await rowOf(c.key);
    if (c.key === bad)
      assert.deepEqual({ ...row }, { status: "failed", attempts: 1 });
    else assert.equal(row.status, "processed");
  }
  assert.ok(seen.length < 10, "split in halves, not one by one");
});

it("when Meta takes nothing (setup: dataset link, token), no event uses up a try, and the run stops early", async () => {
  const due = await optIns(`set-${crypto.randomUUID()}`, 6);
  const { f, seen } = meta(() => 400);
  const r = await sendConversions(due, CFG, f);
  assert.deepEqual([r.sent, r.failed, r.gaveUp], [0, 6, 0]);
  for (const c of due)
    assert.deepEqual(
      { ...(await rowOf(c.key)) },
      { status: "failed", attempts: 0 },
    );
  assert.ok(seen.length < 12, "it did not send all six one by one");
});

it("Meta down or rate limiting is not the events' fault: one request, no splitting, no try used up", async () => {
  const due = await optIns(`dn-${crypto.randomUUID()}`, 4);
  const { f, seen } = meta(() => 503);
  const r = await sendConversions(due, CFG, f);
  assert.equal(seen.length, 1);
  assert.deepEqual([r.sent, r.failed, r.gaveUp], [0, 4, 0]);
  assert.equal((await rowOf(due[0].key)).attempts, 0);
});

it("an event refused on its own, run after run while others go through, gives up (ignored) and shows; --retry-failed makes it due again", async () => {
  const tag = `gv-${crypto.randomUUID()}`;
  const due = await optIns(tag, MAX_ATTEMPTS + 1);
  const bad = due[0];
  const good = due.slice(1);
  const { f } = meta((ids) => (ids.includes(bad.key) ? 400 : 200));
  let last = { sent: 0, failed: 0, gaveUp: 0, skipped: 0 };
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await db()`UPDATE integration_event SET next_attempt_at = now() - interval '1 second'
               WHERE source = ${TEST_SOURCE} AND external_event_id = ${bad.key}`;
    last = await sendConversions([bad, good[i]], CFG, f);
  }
  assert.equal(last.gaveUp, 1);
  assert.deepEqual(
    { ...(await rowOf(bad.key)) },
    { status: "ignored", attempts: MAX_ATTEMPTS },
  );
  assert.equal(
    (await dueConversions(new Date(), TEST_SOURCE)).some(
      (c) => c.key === bad.key,
    ),
    false,
  );

  assert.ok((await retryFailed(TEST_SOURCE)) >= 1);
  assert.equal(
    (await dueConversions(new Date(), TEST_SOURCE)).some(
      (c) => c.key === bad.key,
    ),
    true,
  );
});

it("two runs at once never send the same event: the second finds it taken", async () => {
  const due = await optIns(`cl-${crypto.randomUUID()}`, 3);
  let inner: Awaited<ReturnType<typeof sendConversions>> | undefined;
  const other = meta(() => 200);
  const outer = meta((ids) => {
    // While the first run is mid-send, a second run starts on the same events.
    return ids.length ? 200 : 200;
  });
  const f = (async (url: string, init: RequestInit) => {
    inner ??= await sendConversions(due, CFG, other.f);
    return outer.f(url, init);
  }) as unknown as typeof fetch;
  const r = await sendConversions(due, CFG, f);
  assert.equal(r.sent, 3);
  assert.deepEqual([inner?.sent, inner?.skipped], [0, 3]);
  assert.equal(other.seen.length, 0, "the second run sent nothing");
});

// ---- What counts as a Purchase and an opt-in --------------------------------

async function buyer(clickAt: Date) {
  const n = wa();
  await saveCtwaTouch(n, "Buyer", click(`b-${n}`), clickAt);
  const [person] =
    await db()`SELECT id FROM person WHERE phone_e164 = ${`+${n}`}`;
  const cls = await newClass({ courseId: await newCourse() });
  const e = await enrol(cls, "confirmed", { personId: person.id });
  return { n, e, personId: person.id as string };
}

it("a deposit and a balance are one Purchase, worth both, like one order in the ads report", async () => {
  const b = await buyer(hoursAgo(6));
  await pay(b.e, { amount: "680.00" });
  await pay(b.e, { amount: "320.00" });
  const due = (await mine("purchase:")).filter(
    (c) => c.key === `purchase:crm:${b.e}`,
  );
  assert.equal(due.length, 1);
  assert.equal(Number(due[0].valueMyr), 1000);
});

it("a SalesProcess order paid in three instalments is one Purchase worth all three, as the report counts it", async () => {
  const n = wa();
  await saveCtwaTouch(n, "SP buyer", click(`sp-${n}`), hoursAgo(8));
  const [person] =
    await db()`SELECT id FROM person WHERE phone_e164 = ${`+${n}`}`;
  const contact = crypto.randomUUID();
  const order = crypto.randomUUID();
  await db()`
    INSERT INTO touchpoint (person_id, channel, occurred_at, external_ref)
    VALUES (${person.id}, 'import', now() - interval '9 hours', ${`ghl:${contact}`})`;
  for (const [i, ago] of [
    [0, "5 hours"],
    [1, "3 hours"],
    [2, "1 hour"],
  ] as const)
    await db()`
      INSERT INTO salesprocess_payment (id, order_id, ghl_contact_id, status, amount_myr,
                                        currency, live_mode, paid_at)
      VALUES (${`${order}-${i}`}, ${order}, ${contact}, 'succeeded', 1000, 'MYR', true,
              now() - ${ago}::interval)`;
  const due = (await mine("purchase:")).filter(
    (c) => c.key === `purchase:${order}`,
  );
  assert.equal(due.length, 1);
  assert.equal(Number(due[0].valueMyr), 3000);
  assert.equal(due[0].ctwaClid, `sp-${n}`);
});

it("a click long before the payment gets no credit; a recent one does", async () => {
  const old = await buyer(hoursAgo(24 * 5)); // click 5 days before ...
  await pay(old.e);
  await db()`UPDATE payment SET paid_at = now() - interval '1 hour' WHERE enrolment_id = ${old.e}`;
  const farOld = await buyer(hoursAgo(24 * 20)); // ... 20 days before
  await pay(farOld.e);
  const keys = (await mine("purchase:")).map((c) => c.key);
  assert.equal(keys.includes(`purchase:crm:${old.e}`), true);
  assert.equal(keys.includes(`purchase:crm:${farOld.e}`), false);
});

it("merging two people does not send a second opt-in for the one already told", async () => {
  const admin = await newUser("super_admin");
  const tag = `mg-${crypto.randomUUID()}`;
  const a = wa();
  const b = wa();
  await saveCtwaTouch(a, "Ada", click(`${tag}-a`), hoursAgo(2));
  await saveCtwaTouch(b, "Ada B", click(`${tag}-b`), hoursAgo(30));
  const [pa] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${a}`}`;
  const [pb] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${b}`}`;
  const due = (await mine("lead:")).filter((c) => c.ctwaClid === `${tag}-a`);
  assert.equal(due.length, 1);
  await sendConversions(due, CFG, meta(() => 200).f);

  // B is merged into A: B's earlier click is now A's first.
  await db()`SELECT merge_person(${pb.id}, ${pa.id}, ${admin.id})`;
  const after = (await dueConversions(new Date(), TEST_SOURCE)).filter((c) =>
    c.ctwaClid.startsWith(`${tag}-`),
  );
  assert.deepEqual(after, [], "A was already told about their opt-in");
});
