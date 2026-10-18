// The website's read of the §8.1 feed (lib/public/schedule-feed.ts): the key
// it sends, the five-minute cache it asks for, and what the 10.1 page gets
// when the feed is down. No database: `fetch` is stubbed.
import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  readSchedule,
  resetScheduleCache,
} from "../lib/public/schedule-feed.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const env = {
  APP_BASE_URL: "http://localhost:3000",
  PUBLIC_API_KEY: KEY,
};

const CLASS = {
  id: "1",
  code: "AIA-2610-EN",
  courseName: "AI Agentic Automation",
  track: "certification",
  language: "en",
  startDate: "2026-11-02",
  endDate: "2026-11-03",
  startTime: null,
  endTime: null,
  mode: "in_person",
  venueName: "AI365 Hub",
  city: "Kuala Lumpur",
  priceMyr: "3200.00",
  hrdcClaimable: true,
  seatsLabel: "available" as const,
  registerUrl: "http://localhost:3000/register/AIA-2610-EN",
};

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
let errors: string[] = [];

function stubFetch(answer: () => Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
}

const ok = () =>
  Promise.resolve(
    Response.json({ generatedAt: "2026-11-01T02:00:00Z", classes: [CLASS] }),
  );

beforeEach(() => {
  resetScheduleCache();
  errors = [];
  mock.method(console, "error", (...args: unknown[]) =>
    errors.push(args.join(" ")),
  );
});

test("a good read is fresh, sends the key and asks for the five-minute cache", async () => {
  stubFetch(ok);
  const read = await readSchedule(env);

  assert.equal(read.kind, "fresh");
  assert.equal(read.classes.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3000/api/public/schedule");
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["X-Api-Key"],
    KEY,
  );
  assert.deepEqual((calls[0].init as { next?: unknown }).next, {
    revalidate: 300,
    tags: ["public-schedule"],
  });
});

test("a throw after a good read returns the earlier payload, marked stale, with its own fetchedAt", async () => {
  stubFetch(ok);
  const first = await readSchedule(env);
  assert.equal(first.kind, "fresh");
  const firstFetchedAt = first.fetchedAt;

  stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
  const second = await readSchedule(env);

  assert.equal(second.kind, "stale");
  assert.equal(second.fetchedAt, firstFetchedAt);
  assert.equal(second.classes[0].code, CLASS.code);
  assert.ok(errors.some((e) => e.includes("feed unreachable")));
});

test("a 503 after a good read behaves the same and logs the status", async () => {
  stubFetch(ok);
  await readSchedule(env);

  stubFetch(() =>
    Promise.resolve(
      Response.json({ error: { code: "not_configured" } }, { status: 503 }),
    ),
  );
  const read = await readSchedule(env);

  assert.equal(read.kind, "stale");
  assert.ok(errors.some((e) => e.includes("feed answered 503")));
});

test("a failure with nothing held is unavailable, not an empty schedule", async () => {
  stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
  const read = await readSchedule(env);

  assert.equal(read.kind, "unavailable");
  assert.ok(errors.some((e) => e.includes("feed unreachable")));
});

test("a key under 16 characters is logged, because §8.1 closes the route", async () => {
  stubFetch(ok);
  await readSchedule({ ...env, PUBLIC_API_KEY: "short" });

  assert.ok(errors.some((e) => e.includes("PUBLIC_API_KEY")));
});

test("a missing APP_BASE_URL throws instead of fetching undefined", async () => {
  stubFetch(ok);
  await assert.rejects(
    () => readSchedule({ ...env, APP_BASE_URL: undefined }),
    /APP_BASE_URL is not set/,
  );
  assert.equal(calls.length, 0);
});
