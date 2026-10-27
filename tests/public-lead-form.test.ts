import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
import {
  HONEYPOT_FIELD,
  isHoneypotFilled,
  newIdempotencyKey,
} from "../app/(public)/enquiry/form-contract.ts";
import { buildRequest, wording } from "../app/(public)/enquiry/lead-request.ts";

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

// The browser hands back what `document.cookie` holds, percent-encoded;
// Next's `cookies()` decodes once before the action sees it. A second decode
// corrupted a campaign carrying its own `%` and threw on a bare one, so the
// touch was lost on the server and nowhere else.
test("a cookie read decodes once, whichever side is reading it", () => {
  for (const campaign of ["raya%50off", "50% off", "mastery_202611"]) {
    const t = {
      ...touchFrom("https://lead.test/enquiry", null),
      utmCampaign: campaign,
    };
    const cookie = serialiseTouch(t);
    // The browser: document.cookie gives back exactly what was written.
    assert.deepEqual(parseTouch(cookie), t, `browser read of ${campaign}`);
    // The server: Next has already decoded it once.
    assert.deepEqual(
      parseTouch(decodeURIComponent(cookie)),
      t,
      `server read of ${campaign}`,
    );
  }
});

// The three fixes below are in a client component, which these tests cannot
// mount. Asserting on the source is weaker than driving a browser, but it
// does stop a silent revert of a bug that costs consent or blocks every
// submission.
test("the form's two checkboxes are controlled, like its text fields", () => {
  const form = readFileSync(
    new URL("../app/(public)/enquiry/enquiry-form.tsx", import.meta.url),
    "utf8",
  );
  // React 19 resets a settled `<form action>`, including on an error, so an
  // uncontrolled box would come back unticked after a refused submit.
  for (const name of ["hrdcIntended", "consentMarketing"]) {
    const field = form.slice(form.indexOf(`name="${name}"`));
    assert.match(
      field.slice(0, 200),
      /checked=\{checks\./,
      `${name} is not controlled`,
    );
  }
});

test("Turnstile is rendered explicitly, and removed with the form", () => {
  const form = readFileSync(
    new URL("../app/(public)/enquiry/enquiry-form.tsx", import.meta.url),
    "utf8",
  );
  // Implicit rendering scans the page only when the script loads, so a
  // client-side move back to the form would leave no widget and refuse every
  // submission.
  assert.match(form, /api\.js\?render=explicit/);
  assert.match(form, /window\.turnstile\?\.render\(/);
  assert.doesNotMatch(form, /className="cf-turnstile"/);
  assert.match(form, /window\.turnstile\?\.remove\(/);
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
    const w = wording(c);
    assert.ok(w.length > 0, `${c} has no wording`);
    assert.ok(!routeMessages.includes(w), `${c} leaks the route's message`);
  }
});

test("a missing key reads as our fault, not the visitor's", () => {
  for (const code of ["not_configured", "unauthorized"]) {
    const w = wording(code);
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
  assert.equal(wording("captcha_failed"), wording("captcha_failed"));

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
