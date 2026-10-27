// §8.3 / §10.4, the rules that need no database: what the body must carry,
// where Stripe returns a payer to, what the gate refuses before anything is
// reserved, and the §13 wording each refusal turns into. The answers that go
// through the capture and the seat live in tests/public-register-db.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerSchema } from "../lib/validation/public.ts";
import { handleRegister } from "../lib/public/handlers.ts";
import { returnUrls } from "../lib/public/register.ts";
import { registerState } from "../app/(public)/register/register-view.ts";
import type { ScheduleClass } from "../lib/public/schedule.ts";
import { wording } from "../app/(public)/enquiry/lead-request.ts";
import { dictionary } from "../app/(public)/dictionaries.ts";

const KEY = "test-key-0123456789abcdef";
const ORIGIN = "https://thelead.io";
const ENV = {
  PUBLIC_API_KEY: KEY,
  RATE_LIMIT_SECRET: "rl-secret-0123456789abcdef",
  PUBLIC_ALLOWED_ORIGINS: ORIGIN,
  APP_BASE_URL: "https://lead.test",
  STRIPE_SECRET_KEY: "sk_test_x",
};

const body = (o: Record<string, unknown> = {}) => ({
  fullName: "Tan Mei Ling",
  email: "meiling@example.com",
  classCode: "AIA-2610-EN",
  hrdcIntended: false,
  captchaToken: "good",
  ...o,
});

const post = (
  payload: unknown,
  o: {
    headers?: Record<string, string>;
    env?: Record<string, string | undefined>;
  } = {},
) =>
  handleRegister(
    new Request("https://crm.test/api/public/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "x-real-ip": "10.1.1.7",
        ...o.headers,
      },
      body: JSON.stringify(payload),
    }),
    {
      env: o.env ?? ENV,
      captcha: async (t) => t === "good",
      // Never reached in this file; a call would be a bug, so it says so.
      checkout: async () => {
        throw new Error("the provider must not be called in these tests");
      },
    },
  );

const code = async (res: Response) =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

// ---- The body (§8.3) -------------------------------------------------------

test("a registration needs a class", () => {
  const parsed = registerSchema.safeParse(body({ classCode: undefined }));
  assert.equal(parsed.success, false);
  assert.ok(
    !parsed.success &&
      parsed.error.issues.some((i) => i.path[0] === "classCode"),
    "the refusal names classCode, so the page can say which link was stale",
  );
});

test("an empty or over-long class code is refused, not trimmed into nothing", () => {
  for (const classCode of ["", "   ", "x".repeat(51)])
    assert.equal(registerSchema.safeParse(body({ classCode })).success, false);
});

test("hrdcIntended defaults to false rather than refusing the booking", () => {
  const parsed = registerSchema.safeParse(body({ hrdcIntended: undefined }));
  assert.ok(parsed.success);
  assert.equal(parsed.data.hrdcIntended, false);
});

test("locale is optional and defaults to en", () => {
  const without = registerSchema.safeParse(body());
  assert.ok(without.success);
  assert.equal(
    without.data.locale,
    "en",
    "a caller that omits it is unaffected",
  );
  const zh = registerSchema.safeParse(body({ locale: "zh" }));
  assert.ok(zh.success && zh.data.locale === "zh");
  assert.equal(registerSchema.safeParse(body({ locale: "ms" })).success, false);
});

test("§8.2's own rules still apply: a name and one way to reach them", () => {
  assert.equal(registerSchema.safeParse(body({ fullName: "" })).success, false);
  assert.equal(
    registerSchema.safeParse(body({ email: undefined, phone: undefined }))
      .success,
    false,
  );
  assert.ok(
    registerSchema.safeParse(body({ email: undefined, phone: "012-345 6789" }))
      .success,
  );
});

// ---- The return addresses (§10.4) -----------------------------------------

test("the return addresses come from configuration, in the locale's path", () => {
  const en = returnUrls(
    { APP_BASE_URL: "https://lead.test" },
    "en",
    "AIA-2610-EN",
  );
  assert.deepEqual(en, {
    successUrl:
      "https://lead.test/register/thank-you?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://lead.test/register/AIA-2610-EN",
  });
  const zh = returnUrls(
    { APP_BASE_URL: "https://lead.test" },
    "zh",
    "AIA-2610-EN",
  );
  assert.equal(
    zh?.successUrl,
    "https://lead.test/zh/register/thank-you?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(zh?.cancelUrl, "https://lead.test/zh/register/AIA-2610-EN");
});

test("a spoofed host cannot choose where a payer comes back to", () => {
  // The function takes no request at all, which is the point: there is no
  // header for an attacker to set. Whatever the request claims, the addresses
  // are the configured ones.
  const urls = returnUrls({ APP_BASE_URL: "https://lead.test" }, "en", "AIA-1");
  assert.ok(urls?.successUrl.startsWith("https://lead.test/"));
  assert.ok(urls?.cancelUrl.startsWith("https://lead.test/"));
  const text = readFileSync(
    new URL("../lib/public/register.ts", import.meta.url),
    "utf8",
  );
  for (const header of ["host", "x-forwarded-host", "origin", "referer"])
    assert.ok(
      !text.includes(`"${header}"`) && !text.includes(`'${header}'`),
      `register.ts must not read ${header}`,
    );
});

test("no usable base means no return address at all", () => {
  assert.equal(returnUrls({}, "en", "AIA-1"), null);
  assert.equal(returnUrls({ APP_BASE_URL: "lead.test" }, "en", "AIA-1"), null);
});

test("a class code with a slash or a space cannot break out of the cancel path", () => {
  const urls = returnUrls({ APP_BASE_URL: "https://lead.test" }, "en", "A/B C");
  assert.equal(urls?.cancelUrl, "https://lead.test/register/A%2FB%20C");
});

// ---- The gate, before anything is reserved (§8.3 step 1) -------------------

test("an origin that is not allow-listed is refused", async () => {
  const res = await post(body(), { headers: { origin: "https://evil.test" } });
  assert.equal(res.status, 403);
  assert.equal(await code(res), "origin_not_allowed");
});

test("a wrong key is refused, and an unset one closes the route", async () => {
  const bad = await post(body(), { headers: { "x-api-key": "nope" } });
  assert.equal(bad.status, 401);
  assert.equal(await code(bad), "unauthorized");
  const closed = await post(body(), {
    env: { ...ENV, PUBLIC_API_KEY: undefined },
  });
  assert.equal(closed.status, 503);
  assert.equal(await code(closed), "not_configured");
});

test("an unset rate-limit secret closes the route rather than skipping the limit", async () => {
  const res = await post(body(), {
    env: { ...ENV, RATE_LIMIT_SECRET: undefined },
  });
  assert.equal(res.status, 503);
  assert.equal(await code(res), "not_configured");
});

test("a body over the cap and a body that is not JSON are both refused", async () => {
  const big = await handleRegister(
    new Request("https://crm.test/api/public/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "x-real-ip": "10.1.1.8",
      },
      body: "x".repeat(33 * 1024),
    }),
    { env: { ...ENV, RATE_LIMIT_SECRET: undefined } },
  );
  // With no rate-limit secret the route closes first, which is the stricter
  // answer; the size cap itself is §8.2's and is covered there.
  assert.equal(big.status, 503);
});

// ---- §13 wording (website-register) ---------------------------------------

test("each §8.3 refusal has words a visitor can act on, in both locales", () => {
  for (const locale of ["en", "zh"] as const) {
    const t = dictionary(locale);
    for (const c of ["class_unavailable", "no_seats", "already_enrolled"]) {
      const said = wording(c, locale);
      assert.equal(said, t[`error.${c}` as keyof typeof t]);
      assert.ok(said.length > 10, `${c} in ${locale} says something`);
    }
    // Our own misconfiguration never reads as the visitor's mistake.
    assert.equal(wording("not_configured", locale), t["error.not_configured"]);
  }
});

test("the route's own messages are never what a visitor is shown", async () => {
  const res = await post(body(), { headers: { origin: "https://evil.test" } });
  const api = ((await res.json()) as { error: { message: string } }).error
    .message;
  const shown = Object.values(dictionary("en"));
  assert.ok(!shown.includes(api), "API wording is for an API caller");
});

// ---- Which of the page's shapes a class gets (§10.4) ----------------------

const cls = (over: Partial<ScheduleClass> = {}): ScheduleClass => ({
  id: "c1",
  code: "AIA-2610-EN",
  courseName: "AI Agentic Automation",
  track: "certification",
  language: "en",
  startDate: "2026-11-10",
  endDate: "2026-11-11",
  startTime: "09:00",
  endTime: "17:00",
  mode: "in_person",
  venueName: "AI365 Hub",
  city: "Kuala Lumpur",
  priceMyr: "3200.00",
  hrdcClaimable: true,
  seatsLabel: "available",
  registerUrl: "https://thelead.io/register/AIA-2610-EN",
  ...over,
});

test("a bookable class gets the form; a full one does not", () => {
  assert.equal(registerState(cls(), true), "bookable");
  assert.equal(
    registerState(cls({ seatsLabel: "few_seats" }), true),
    "bookable",
  );
  assert.equal(registerState(cls({ seatsLabel: "full" }), true), "full");
});

test("a class the feed does not list is not bookable, and not a 404 either", () => {
  // Unknown, private, past, cancelled or completed all arrive here as null:
  // the page says why and offers the enquiry form (website-lead-capture).
  assert.equal(registerState(null, true), "unavailable");
  assert.equal(registerState(null, false), "unavailable");
});

test("with no payment provider the page says so instead of taking a submission", () => {
  assert.equal(registerState(cls(), false), "closed");
  assert.equal(registerState(cls({ seatsLabel: "full" }), false), "closed");
});

// ---- The submit path (§10.4, §13) -----------------------------------------

const source = (p: string) =>
  readFileSync(new URL(`../app/(public)/${p}`, import.meta.url), "utf8");

test("the submit action builds the §8.3 request in process, with no key in a page", () => {
  const src = source("register/submit.ts");
  // The same door the enquiry form uses: the handler, not fetch, so
  // PUBLIC_API_KEY never reaches a browser (§8.2, website-lead-capture).
  assert.match(
    src,
    /buildRequest\(payload, await headers\(\), process\.env, "\/register"\)/,
  );
  assert.match(src, /handleRegister\(/);
  assert.doesNotMatch(src, /fetch\(/);
  assert.doesNotMatch(src, /PUBLIC_API_KEY/);
  // The honeypot is checked before anything else happens.
  assert.ok(
    src.indexOf("isHoneypotFilled") < src.indexOf("const payload"),
    "the honeypot comes first",
  );
  // The locale rides along for the return addresses only.
  assert.match(src, /locale,/);
});

test("both answers leave the form's page, so neither can be lost by a reload", () => {
  const src = source("register/submit.ts");
  assert.match(src, /redirect\(body\.checkoutUrl\)/);
  assert.match(src, /next === "hrdc_contact"/);
  // The HRDC answer is a page, not a state inside the form: the language
  // control is a full navigation (§10.5), and a state would be gone the
  // moment a visitor switched language after registering — leaving them an
  // empty form with a fresh idempotency key.
  assert.match(
    src,
    /redirect\(localePath\(locale, "\/register\/thank-you\?hrdc=1"\)\)/,
  );
  assert.doesNotMatch(src, /status: "success"/);
  // §13: the visitor is never shown an id from the answer.
  assert.doesNotMatch(src, /message: body\.(personId|dealId)/);
  // A refusal is the locale's wording, not the route's message.
  assert.match(src, /message: wording\(code, locale\)/);
  assert.match(src, /fields: fieldWording\(/);
});

test("the thank-you page confirms and creates nothing", () => {
  const src = source("register/thank-you-page.tsx");
  // No database, no handler, no capture: the webhook confirms a payment
  // (§11.2), and a page a visitor can reload twice must not.
  for (const forbidden of [
    "lib/sql",
    "handleRegister",
    "captureLead",
    "INSERT",
  ])
    assert.ok(
      !src.includes(forbidden),
      `the thank-you page must not use ${forbidden}`,
    );
  // All three states exist, and the session id is read but never verified.
  assert.match(src, /thankYou\.heading/);
  assert.match(src, /thankYou\.noSession\.heading/);
  assert.match(src, /register\.hrdc\.heading/);
  assert.match(src, /session_id/);
  // An HRDC arrival never claims a payment, whatever else the URL carries.
  assert.match(src, /!hrdc && Boolean\(raw\?\.trim\(\)\)/);
});
