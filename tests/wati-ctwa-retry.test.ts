import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { watiMessagesSince, watiRetry } from "../lib/import/wati-ctwa.ts";

const realFetch = globalThis.fetch;
let calls = 0;

beforeEach(() => {
  process.env.WATI_API_HOST = "https://wati.test";
  process.env.WATI_API_TOKEN = "t";
  watiRetry.baseMs = 1;
  calls = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ok = () =>
  new Response(JSON.stringify({ messages: { items: [], hasNextPage: false } }));

test("a transient 401 is retried and the call succeeds", async () => {
  globalThis.fetch = (async () =>
    ++calls < 3 ? new Response("", { status: 401 }) : ok()) as typeof fetch;
  assert.deepEqual(await watiMessagesSince("6012", new Date(0)), []);
  assert.equal(calls, 3);
});

test("a 401 that persists fails with a token hint", async () => {
  globalThis.fetch = (async () => {
    calls++;
    return new Response("", { status: 401 });
  }) as typeof fetch;
  await assert.rejects(
    watiMessagesSince("6012", new Date(0)),
    /HTTP 401 after 5 attempts.*WATI_API_TOKEN/,
  );
  assert.equal(calls, watiRetry.attempts);
});

test("a 404 is not retried", async () => {
  globalThis.fetch = (async () => {
    calls++;
    return new Response("", { status: 404 });
  }) as typeof fetch;
  await assert.rejects(watiMessagesSince("6012", new Date(0)), /HTTP 404/);
  assert.equal(calls, 1);
});

test("a network error is retried", async () => {
  globalThis.fetch = (async () => {
    if (++calls < 2) throw new TypeError("fetch failed");
    return ok();
  }) as typeof fetch;
  await watiMessagesSince("6012", new Date(0));
  assert.equal(calls, 2);
});
