// Meta Conversions API (lib/meta/capi.ts): which conversions are due, the
// event Meta gets, and the send ledger. Meta's endpoint is a stub: nothing
// leaves the machine. Each DB test rolls back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { saveCtwaTouch } from "../lib/import/wati-ctwa.ts";
import {
  configFromEnv,
  dueConversions,
  sendConversions,
  TEST_SOURCE,
  toMetaEvent,
  type CapiConfig,
} from "../lib/meta/capi.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, pay } from "./seed.ts";

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
      { key: "purchase:crm:1", eventName: "Purchase", at, ctwaClid: "clid", valueMyr: "680.00" },
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
    { key: "lead:x", eventName: "LeadSubmitted", at, ctwaClid: "c", valueMyr: null },
    "w",
  );
  assert.equal("custom_data" in lead, false);
});

test("config: all three ids needed; test code dropped only with --live", () => {
  assert.equal(configFromEnv({}, false), "not set: META_DATASET_ID, META_CAPI_TOKEN, META_WABA_ID");
  const env = { META_DATASET_ID: "d", META_CAPI_TOKEN: "t", META_WABA_ID: "w", META_TEST_EVENT_CODE: "T1" };
  assert.equal((configFromEnv(env, false) as CapiConfig).testEventCode, "T1");
  assert.equal((configFromEnv(env, true) as CapiConfig).testEventCode, null);
});

const wa = () => `6011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const click = (clid: string) => ({ adId: "52508930802001", ctwaClid: clid, headline: null, url: null });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const mine = async (prefix: string) =>
  (await dueConversions()).filter((c) => c.key.startsWith(prefix));

type Call = { url: string; body: Record<string, unknown> };
function stub(status = 200) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(status === 200 ? { events_received: 1 } : { error: { message: "Invalid parameter" } }), { status });
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
  assert.deepEqual(await sendConversions(due, CFG, f), { sent: 1, failed: 0 });
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/dataset-test-1/events");
  assert.equal(calls[0].body.test_event_code, "TEST123");
  // No phone number anywhere in what Meta receives.
  assert.equal(JSON.stringify(calls[0].body).includes(n), false);
  assert.equal((await dueConversions(new Date(), TEST_SOURCE)).some((c) => c.key === key), false);
});

it("a later ad click by the same person is not a second opt-in", async () => {
  const n = wa();
  await saveCtwaTouch(n, "Ada", click(`a-${n}`), hoursAgo(5));
  await saveCtwaTouch(n, "Ada", click(`b-${n}`), hoursAgo(1));
  const due = (await mine("lead:")).filter((c) => c.ctwaClid.endsWith(n));
  assert.deepEqual(due.map((c) => c.ctwaClid), [`a-${n}`]);
});

it("an opt-in older than 7 days is not sent", async () => {
  const n = wa();
  await saveCtwaTouch(n, "Old", click(`old-${n}`), hoursAgo(24 * 8));
  assert.equal((await mine("lead:")).some((c) => c.ctwaClid === `old-${n}`), false);
});

it("a payment after an ad click is a Purchase with the net value", async () => {
  const n = wa();
  const t = await saveCtwaTouch(n, "Buyer", click(`p-${n}`), hoursAgo(3));
  assert.equal(t.kind, "saved");
  const [person] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${n}`}`;
  const cls = await newClass({ courseId: await newCourse() });
  const e = await enrol(cls, "confirmed", { personId: person.id });
  const paymentId = await pay(e, { amount: "680.00" });
  const due = (await mine("purchase:")).filter((c) => c.key === `purchase:crm:${paymentId}`);
  assert.equal(due.length, 1);
  assert.equal(due[0].ctwaClid, `p-${n}`);
  assert.equal(Number(due[0].valueMyr), 680);
});

it("a buyer with no ad click is not sent to Meta", async () => {
  const cls = await newClass({ courseId: await newCourse() });
  const paymentId = await pay(await enrol(cls, "confirmed"));
  assert.equal((await mine("purchase:")).some((c) => c.key === `purchase:crm:${paymentId}`), false);
});

it("a refused send is marked failed and waits before it is due again", async () => {
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
  assert.deepEqual({ ...row }, { status: "failed", attempts: 1, waiting: true });
  assert.equal((await dueConversions(new Date(), TEST_SOURCE)).some((c) => c.ctwaClid === `f-${n}`), false);
});

it("a test send does not count as sent for the live run", async () => {
  const n = wa();
  const clid = `t-${crypto.randomUUID()}`;
  await saveCtwaTouch(n, "Ada", click(clid), hoursAgo(1));
  const due = (await dueConversions(new Date(), TEST_SOURCE)).filter((c) => c.ctwaClid === clid);
  const { f } = stub();
  await sendConversions(due, CFG, f); // CFG carries a test code
  assert.equal((await dueConversions(new Date(), TEST_SOURCE)).some((c) => c.ctwaClid === clid), false);
  assert.equal((await mine("lead:")).some((c) => c.ctwaClid === clid), true);
});
