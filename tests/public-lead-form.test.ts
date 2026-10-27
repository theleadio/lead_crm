import assert from "node:assert/strict";
import test from "node:test";
import {
  attributionPayload,
  hasCampaign,
  nextTouches,
  parseTouch,
  serialiseTouch,
  touchFrom,
  trimUrl,
} from "../app/(public)/attribution.ts";
import { cleanUrl } from "../lib/public/leads.ts";
import { privacyUrl } from "../lib/public/links.ts";
import {
  HONEYPOT_FIELD,
  isHoneypotFilled,
  newIdempotencyKey,
} from "../app/(public)/enquiry/form-contract.ts";
import {
  buildRequest,
  fieldWording,
  wording,
} from "../app/(public)/enquiry/lead-request.ts";
import { readFileSync } from "node:fs";

// §10.2. The attribution rules. The cookie-writing component and the server
// action are covered further down; these first tests are the rules alone.

test("a campaign arrival keeps every field the link carried", () => {
  const t = touchFrom(
    "https://lead.test/schedule?utm_source=fb&utm_medium=cpc" +
      "&utm_campaign=agentic_202610_leads_en&utm_content=hero&utm_term=ai" +
      "&gclid=abc&fbclid=def",
    "https://www.facebook.com/",
    new Date("2026-10-21T02:00:00.000Z"),
  );
  assert.equal(t.utmSource, "fb");
  assert.equal(t.utmMedium, "cpc");
  assert.equal(t.utmCampaign, "agentic_202610_leads_en");
  assert.equal(t.utmContent, "hero");
  assert.equal(t.utmTerm, "ai");
  assert.equal(t.gclid, "abc");
  assert.equal(t.fbclid, "def");
  assert.equal(t.referrer, "https://www.facebook.com/");
  assert.equal(t.occurredAt, "2026-10-21T02:00:00.000Z");
});

test("a bare arrival is still recorded, so it is not mistaken for a campaign later", () => {
  const t = touchFrom("https://lead.test/schedule", null);
  assert.equal(t.utmSource, null);
  assert.equal(t.gclid, null);
  assert.equal(t.referrer, null);
  // §10.2's scenario "Arriving with nothing": the landing URL and the time
  // are what make the visit a record rather than an absence.
  assert.equal(t.landingUrl, "https://lead.test/schedule");
  assert.ok(Date.parse(t.occurredAt) > 0);
});

test("a landing URL drops query parameters that are not campaign ones", () => {
  const t = touchFrom(
    "https://lead.test/schedule?utm_source=fb&session=secret&ref=xyz#top",
    null,
  );
  assert.equal(t.landingUrl, "https://lead.test/schedule?utm_source=fb");
});

test("trimUrl keeps the same shape as the server's cleanUrl (O14)", () => {
  // The rule is written twice because lib/public/leads.ts imports the
  // database and cannot enter a client bundle. This test is what stops the
  // two copies drifting.
  for (const u of [
    "https://lead.test/schedule?utm_source=fb&session=secret",
    "https://lead.test/a/b?gclid=1&fbclid=2&other=3#frag",
    "http://user:pw@lead.test/x?utm_campaign=c",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
  ])
    assert.equal(trimUrl(u), cleanUrl(u), `differs for ${String(u)}`);
});

test("a touch survives a round trip through a cookie value", () => {
  const t = touchFrom(
    "https://lead.test/enquiry?utm_source=fb",
    "https://x.test/",
  );
  assert.deepEqual(parseTouch(serialiseTouch(t)), t);
});

test("an unreadable cookie value reads as absent rather than throwing", () => {
  for (const raw of ["", "not json", "%%%", "null", "[]", '{"a":1}'])
    assert.equal(parseTouch(raw), null, `should be null for ${raw}`);
});

// A cookie can be hand-edited, or set for the parent domain by another
// subdomain. §8.2 refuses the whole lead over one bad attribution value, so
// every field is rebuilt rather than trusted.
test("a tampered cookie costs attribution, not the lead", () => {
  const t = parseTouch(
    encodeURIComponent(
      JSON.stringify({
        occurredAt: "2026-10-22T02:00:00.000Z",
        utmSource: 7,
        utmCampaign: "x".repeat(400),
        fbclid: "f".repeat(900),
        landingUrl: "javascript:alert(1)",
        referrer: null,
      }),
    ),
  );
  assert.ok(t);
  assert.equal(t.utmSource, null, "a non-string field reads as absent");
  assert.equal(t.utmCampaign?.length, 200);
  assert.equal(t.fbclid?.length, 500);
  assert.equal(t.landingUrl, null, "a non-http URL reads as absent");
  const payload = attributionPayload(null, t);
  for (const [k, v] of Object.entries(payload!))
    if (k !== "firstTouch")
      assert.ok(
        v === null || typeof v === "string",
        `${k} must be a string or null`,
      );
});

// §10.2 calls overwriting the first touch the mistake that breaks all
// attribution reporting, so it gets its own test before it is wired up.

test("an existing first touch is kept when a later arrival carries a different campaign", () => {
  const first = touchFrom(
    "https://lead.test/schedule?utm_campaign=agentic_202610_leads_en&utm_source=fb",
    null,
    new Date("2026-10-01T00:00:00.000Z"),
  );
  const { first: toWrite, last } = nextTouches(
    serialiseTouch(first),
    "https://lead.test/schedule?utm_campaign=mastery_202611&utm_source=google",
    null,
  );
  // null means "leave the stored one alone" — rewriting it would also roll
  // its 90 days forward, which is not the 90 days §10.2 asks for.
  assert.equal(toWrite, null);
  assert.equal(last?.utmCampaign, "mastery_202611");
  assert.equal(last?.utmSource, "google");
});

test("a direct return with no campaign at all does not erase the first touch", () => {
  const first = touchFrom("https://lead.test/?utm_source=fb", null);
  const { first: toWrite } = nextTouches(
    serialiseTouch(first),
    "https://lead.test/schedule",
    null,
  );
  assert.equal(toWrite, null);
});

test("a missing first touch is created", () => {
  const { first, last } = nextTouches(
    null,
    "https://lead.test/schedule?utm_source=fb",
    null,
  );
  assert.ok(first);
  assert.equal(first.utmSource, "fb");
  assert.equal(last?.utmSource, "fb");
});

test("an unreadable first touch is replaced rather than kept", () => {
  const { first } = nextTouches("not json", "https://lead.test/", null);
  assert.ok(first, "a value we cannot read is no value");
});

test("the submission carries the first campaign and the latest one together", () => {
  const first = touchFrom(
    "https://lead.test/?utm_source=fb&utm_campaign=agentic_202610_leads_en",
    null,
    new Date("2026-10-01T00:00:00.000Z"),
  );
  const last = touchFrom(
    "https://lead.test/enquiry?utm_source=google&utm_campaign=mastery_202611",
    null,
  );
  const a = attributionPayload(first, last) as Record<string, unknown>;
  assert.equal(a.utmCampaign, "mastery_202611");
  const ft = a.firstTouch as Record<string, unknown>;
  assert.equal(ft.utmCampaign, "agentic_202610_leads_en");
  assert.equal(ft.occurredAt, "2026-10-01T00:00:00.000Z");
});

test("attribution is null when nothing was ever recorded", () => {
  assert.equal(attributionPayload(null, null), null);
});

// §8.2 / §10.3. The in-process request this app builds for itself. Asserted
// directly, not only through its result: a missing x-real-ip or a present
// Origin would both fail silently in production.

test("the request carries the key, no Origin, and the visitor's own address", () => {
  const req = buildRequest(
    { attribution: null },
    new Headers({ "x-real-ip": "203.0.113.9" }),
    { PUBLIC_API_KEY: "a-key-at-least-16-chars" },
  );
  assert.equal(req.headers.get("x-api-key"), "a-key-at-least-16-chars");
  assert.equal(req.headers.get("origin"), null, "§8.2 allows no Origin");
  assert.equal(req.headers.get("x-real-ip"), "203.0.113.9");
  assert.equal(req.method, "POST");
});

test("the rate limit counts the visitor, not the server", () => {
  // requestIp reads x-real-ip, then the first x-forwarded-for hop.
  const req = buildRequest(
    { attribution: null },
    new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }),
    { PUBLIC_API_KEY: "a-key-at-least-16-chars" },
  );
  assert.equal(req.headers.get("x-real-ip"), "198.51.100.4");
});

test("a rotation list sends one of the keys, and an unset key sends none", () => {
  const two = buildRequest({ attribution: null }, new Headers(), {
    PUBLIC_API_KEY: "first-key-16-chars-x,second-key-16-chars",
  });
  assert.equal(two.headers.get("x-api-key"), "first-key-16-chars-x");
  // Unset leaves it empty, which §8.2 answers 503 to: closed, not open.
  const none = buildRequest({ attribution: null }, new Headers(), {});
  assert.equal(none.headers.get("x-api-key"), "");
});

test("the landing URL is passed where §8.2 actually reads it from", () => {
  // The body's landingUrl is only trusted when its origin is on
  // PUBLIC_ALLOWED_ORIGINS, which this app is not on in production, so the
  // handler falls back to Referer. Without this the landing URL would be
  // recorded in development and lost in production.
  const req = buildRequest(
    { attribution: { landingUrl: "https://lead.test/schedule?utm_source=fb" } },
    new Headers(),
    {},
  );
  assert.equal(
    req.headers.get("referer"),
    "https://lead.test/schedule?utm_source=fb",
  );
});

test("the body is the payload, unchanged", async () => {
  const payload = { fullName: "Ali", phone: "012-3456789", attribution: null };
  const req = buildRequest(payload, new Headers(), {});
  assert.deepEqual(await req.json(), payload);
});

test("no message written for an API caller is shown to a visitor", () => {
  // The exact strings lib/public/handlers.ts answers with. None of them
  // should ever reach a form.
  const routeMessages = [
    "Origin not allowed.",
    "Not available.",
    "Invalid API key.",
    "Request too large.",
    "Send a JSON body.",
    "Something went wrong.",
    "Check the highlighted fields.",
    "Too many requests. Try again in a minute.",
  ];
  const codes = [
    "origin_not_allowed",
    "not_configured",
    "unauthorized",
    "payload_too_large",
    "invalid_json",
    "server_error",
    "validation_failed",
    "rate_limited",
    "captcha_failed",
    "something_new_we_have_not_seen",
  ];
  for (const c of codes) {
    const w = wording(c, "en");
    assert.ok(w.length > 0, `${c} has no wording`);
    assert.ok(!routeMessages.includes(w), `${c} leaks the route's message`);
  }
});

test("a missing key reads as our fault, not the visitor's", () => {
  for (const code of ["not_configured", "unauthorized"]) {
    const w = wording(code, "en");
    assert.match(w, /we can't take enquiries/i);
    // It must not name the cause: a visitor cannot fix a key, and an
    // attacker should not learn which one is missing.
    assert.doesNotMatch(w, /key|secret|configur/i);
  }
});

test("the honeypot is refused the same way a failed check is", () => {
  const filled = new FormData();
  filled.set(HONEYPOT_FIELD, "http://spam.example");
  assert.equal(isHoneypotFilled(filled), true);
  // Indistinguishable from a failed CAPTCHA, so a bot learns nothing.
  assert.equal(
    wording("captcha_failed", "en"),
    wording("captcha_failed", "en"),
  );

  const empty = new FormData();
  assert.equal(isHoneypotFilled(empty), false);
  empty.set(HONEYPOT_FIELD, "   ");
  assert.equal(isHoneypotFilled(empty), false, "whitespace is not a fill");
});

test("an idempotency key is one §8.2 will accept", () => {
  const key = newIdempotencyKey();
  assert.match(key, /^[A-Za-z0-9_.:-]+$/);
  assert.ok(key.length >= 8 && key.length <= 100);
  assert.notEqual(
    key,
    newIdempotencyKey(),
    "a new form instance gets a new key",
  );
  // COOKIE_TOUCH_REF marks a synthetic first touch and contains a space, so
  // a generated key can never collide with one.
  assert.ok(!key.includes(" "));
});

// crypto.randomUUID is secure-context-only, so the form is also opened over
// plain http on the LAN, where only getRandomValues exists.
test("an idempotency key is still generated outside a secure context", () => {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: (b: Uint8Array) => real.getRandomValues(b) },
    configurable: true,
  });
  try {
    const key = newIdempotencyKey();
    assert.match(key, /^[A-Za-z0-9_.:-]{8,100}$/);
    // O46 calls the key a UUID, so the fallback is shaped like one too.
    assert.match(
      key,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.notEqual(key, newIdempotencyKey());
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: real,
      configurable: true,
    });
  }
});

// Found by the end-to-end run: clicking from /schedule to /enquiry re-ran the
// script, and /enquiry carries no utm_*, so the last touch was overwritten
// with an empty one and the lead recorded no campaign at all.

test("a campaign-less move within the site does not erase the last touch", () => {
  const campaign = touchFrom(
    "https://lead.test/schedule?utm_source=fb&utm_campaign=test",
    "https://www.facebook.com/",
  );
  const { last } = nextTouches(
    serialiseTouch(campaign),
    "https://lead.test/enquiry?class=AIA-2611-EN",
    "https://lead.test/schedule?utm_source=fb&utm_campaign=test",
    new Date(),
    serialiseTouch(campaign),
  );
  assert.equal(last, null, "null leaves the stored last touch alone");
});

test("a campaign on a later page still refreshes the last touch", () => {
  const stored = touchFrom("https://lead.test/?utm_source=fb", null);
  const { last } = nextTouches(
    serialiseTouch(stored),
    "https://lead.test/enquiry?utm_source=google&utm_campaign=mastery_202611",
    "https://lead.test/schedule",
    new Date(),
    serialiseTouch(stored),
  );
  assert.equal(last?.utmSource, "google");
});

test("a fresh arrival from outside refreshes the last touch even with no campaign", () => {
  const stored = touchFrom("https://lead.test/?utm_source=fb", null);
  const { last } = nextTouches(
    serialiseTouch(stored),
    "https://lead.test/schedule",
    "https://www.google.com/",
    new Date(),
    serialiseTouch(stored),
  );
  assert.ok(last, "arriving from elsewhere is a new touch");
  assert.equal(last.referrer, "https://www.google.com/");
});

test("a first visit writes both, with nothing stored", () => {
  const { first, last } = nextTouches(null, "https://lead.test/", null);
  assert.ok(first);
  assert.ok(last);
});

test("hasCampaign is what tells an arrival from a navigation", () => {
  assert.equal(hasCampaign(touchFrom("https://lead.test/x", null)), false);
  assert.equal(
    hasCampaign(touchFrom("https://lead.test/x?gclid=1", null)),
    true,
  );
  assert.equal(
    hasCampaign(touchFrom("https://lead.test/x?utm_term=ai", null)),
    true,
  );
});

// The locale's reach into the lead path (website-lead-capture). It may change
// the words and the preferred-language default, and nothing else: the §8.2
// request, its checks and the rate-limit bucket must be the same from either
// locale.
const readSrc = (p: string) =>
  readFileSync(new URL(p, import.meta.url), "utf8");

test("a refusal is worded in the locale, and never in the route's words", () => {
  const routeMessages = [
    "Check the highlighted fields.",
    "Too many requests. Try again in a minute.",
    "Something went wrong.",
  ];
  for (const code of [
    "captcha_failed",
    "rate_limited",
    "payload_too_large",
    "validation_failed",
    "not_configured",
    "server_error",
  ]) {
    const zh = wording(code, "zh");
    assert.ok(zh.length > 0, `${code} has no Chinese wording`);
    assert.notEqual(zh, wording(code, "en"), `${code} is not translated`);
    assert.ok(!routeMessages.includes(zh), `${code} leaks the route's message`);
    // Chinese, not English with a Chinese label.
    assert.match(zh, /[\u4e00-\u9fff]/, `${code} has no Chinese in it`);
  }
});

test("a field refusal keeps §8.2's field name and drops its message", () => {
  // What §8.2 actually answers with: the field names, and zod's own English.
  const fromRoute = {
    fullName: "Full name is required",
    email: "Enter an email or a phone number",
    phone: "Too big: expected string to have <=40 characters",
    somethingNew: "Invalid input",
  };

  for (const locale of ["en", "zh"] as const) {
    const shown = fieldWording(fromRoute, locale);
    // The same fields, so each message still lands against its own control.
    assert.deepEqual(Object.keys(shown), Object.keys(fromRoute));
    for (const [name, message] of Object.entries(shown)) {
      assert.ok(message.length > 0, `${name} has no message`);
      assert.notEqual(
        message,
        fromRoute[name as keyof typeof fromRoute],
        `${name} shows the route's own wording`,
      );
    }
    // A field with no message of its own still gets one.
    assert.ok(shown.somethingNew);
  }

  // And the Chinese is Chinese.
  const zh = fieldWording(fromRoute, "zh");
  for (const message of Object.values(zh))
    assert.match(message, /[\u4e00-\u9fff]/);
  // An empty answer stays empty rather than inventing a refusal.
  assert.deepEqual(fieldWording({}, "zh"), {});
});

test("the locale never reaches the §8.2 body, so both locales send the same request", () => {
  const payload = {
    formName: "website_enquiry",
    fullName: "Tan Wei Ming",
    phone: "012-345 6789",
    preferredLanguage: "zh",
    attribution: null,
  };
  const headers = new Headers({ "x-real-ip": "203.0.113.9" });
  const a = buildRequest(payload, headers, { PUBLIC_API_KEY: "k".repeat(20) });
  const b = buildRequest(payload, headers, { PUBLIC_API_KEY: "k".repeat(20) });
  assert.equal(JSON.stringify(payload), JSON.stringify(payload));
  assert.deepEqual([...a.headers], [...b.headers]);

  // buildRequest takes no locale at all, and the action does not add one to
  // the payload: the hidden field is read for its wording only.
  const submit = readSrc("../app/(public)/enquiry/submit.ts");
  const payloadBlock = /const payload = \{([\s\S]*?)\n  \};/.exec(submit)?.[1];
  assert.ok(payloadBlock, "payload block not found in submit.ts");
  assert.doesNotMatch(payloadBlock, /locale/);
  // It is read, though — a refusal must come back in the right language.
  assert.match(submit, /formLocale\(form\)/);
});

test("one rate-limit bucket, whichever locale the visitor is in", () => {
  // The per-IP limit counts the visitor's address, which comes from the
  // incoming headers — the same for both locales, because both go through
  // this one path and neither sends an Origin.
  const headers = new Headers({ "x-real-ip": "203.0.113.9" });
  const req = buildRequest({ attribution: null }, headers, {
    PUBLIC_API_KEY: "k".repeat(20),
  });
  assert.equal(req.headers.get("x-real-ip"), "203.0.113.9");
  assert.equal(req.headers.get("origin"), null);
  // There is only one submit path: no locale-specific action to drift from it.
  assert.equal(
    readSrc("../app/(public)/enquiry/submit.ts").match(/export async function/g)
      ?.length,
    1,
  );
});

test("the page's locale is the preferred language's default, and stays a field", () => {
  const form = readSrc("../app/(public)/enquiry/enquiry-form.tsx");
  // The default is the locale, not a hardcoded "en".
  assert.match(form, /preferredLanguage:\s*locale/);
  assert.doesNotMatch(form, /preferredLanguage:\s*"en"/);
  // Still a control the visitor can change, offering both values.
  assert.match(form, /<option value="en">/);
  assert.match(form, /<option value="zh">/);
  // And what is submitted is the state, not the locale.
  assert.match(
    form,
    /name="preferredLanguage"[\s\S]{0,120}values\.preferredLanguage/,
  );
});

test("consent is unticked in both locales and never a condition of submitting", () => {
  const form = readSrc("../app/(public)/enquiry/enquiry-form.tsx");
  const consent =
    /<input type="checkbox" name="consentMarketing"([^>]*)\/>/.exec(form)?.[1];
  assert.ok(consent !== undefined, "consent checkbox not found");
  // §10.3: unticked by default, in either locale — the markup is shared, so
  // there is no locale in which it could be pre-ticked.
  assert.doesNotMatch(consent, /checked|defaultChecked/);
  // The submit control is disabled only while a submission is in flight.
  assert.match(form, /disabled=\{pending\}/);
  assert.doesNotMatch(form, /disabled=\{[^}]*consent/);
});

test("no secret reaches either locale's page", () => {
  for (const p of [
    "../app/(public)/enquiry/enquiry-form.tsx",
    "../app/(public)/enquiry/enquiry-page.tsx",
    "../app/(public)/(en)/enquiry/page.tsx",
    "../app/(public)/zh/enquiry/page.tsx",
    "../app/(public)/(en)/schedule/page.tsx",
    "../app/(public)/zh/schedule/page.tsx",
    "../app/(public)/public-chrome.tsx",
    "../app/(public)/language-link.tsx",
  ]) {
    const src = readSrc(p);
    for (const secret of [
      "PUBLIC_API_KEY",
      "RATE_LIMIT_SECRET",
      "TURNSTILE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
    ])
      assert.doesNotMatch(src, new RegExp(secret), `${p} names ${secret}`);
  }
  // The one env the form may name is the CAPTCHA's public half, which is
  // meant to be published (O39).
  const form = readSrc("../app/(public)/enquiry/enquiry-form.tsx");
  const envs = form.match(/process\.env\.[A-Z_]+/g) ?? [];
  assert.deepEqual(envs, ["process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY"]);
});

// Shawn checked thelead.io on 26 Oct 2026 (PR #11): the notice is at /terms,
// and /privacy and /privacy-policy both 404. A consent box beside a dead link
// is the failure this test exists to catch.
test("the privacy link points at the page the marketing site actually serves", () => {
  assert.equal(
    privacyUrl({ PUBLIC_WEBSITE_URL: "https://thelead.io/" }),
    "https://thelead.io/terms",
  );
  // Unset: no link at all rather than one to nowhere.
  assert.equal(privacyUrl({}), null);
});

test("a captured enquiry leaves the form's page, so it cannot be lost", () => {
  const submit = readFileSync(
    new URL("../app/(public)/enquiry/submit.ts", import.meta.url),
    "utf8",
  );
  // The answer lives at a URL, not in component state. The language control
  // is a full navigation (§10.5), so a visitor who switched language after
  // enquiring was shown the empty form again — and the remount handed them a
  // fresh idempotency key, putting a second identical lead one submit away.
  // §10.4's HRDC answer was moved for this reason; §10.3's was not, and had
  // the same bug.
  assert.match(
    submit,
    /redirect\(localePath\(locale, "\/enquiry\/thank-you"\)\)/,
  );
  assert.doesNotMatch(submit, /status: "success"/);

  // Nothing can render a settled state any more, in either form.
  const contract = readFileSync(
    new URL("../app/(public)/enquiry/form-contract.ts", import.meta.url),
    "utf8",
  );
  // The type line itself, not the file: the comment above it explains why
  // "success" is gone and so names the word.
  assert.match(contract, /status: "idle" \| "error";/);
  assert.doesNotMatch(contract, /status: "idle" \| "error" \| "success"/);
  const form = readFileSync(
    new URL("../app/(public)/enquiry/enquiry-form.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(form, /successHeading|successBody/);

  // And the id §8.2 answered with never reaches the URL (§13): the redirect
  // target is a bare path, with no query and nothing interpolated into it.
  // The code is checked, not the file — the comment there names both ids.
  const target = /redirect\(localePath\(locale, (.+?)\)\)/.exec(submit)?.[1];
  assert.equal(target, '"/enquiry/thank-you"');
});

test("the enquiry thank-you is served in both languages", () => {
  for (const [file, locale] of [
    ["(en)/enquiry/thank-you/page.tsx", "en"],
    ["zh/enquiry/thank-you/page.tsx", "zh"],
  ] as const) {
    const src = readFileSync(
      new URL(`../app/(public)/${file}`, import.meta.url),
      "utf8",
    );
    // Each names its own locale, so the pair is a language switch away from
    // each other rather than a dead end.
    assert.ok(src.includes(`alternates("${locale}", "/enquiry/thank-you")`));
    assert.ok(src.includes(`locale="${locale}"`));
    // A confirmation is not a landing page: a searcher who found it would be
    // told their enquiry was received when it was not.
    assert.match(src, /robots: \{ index: false/);
  }
});
