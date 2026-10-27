// Spec §8.1 / §8.2 public API: key, CORS, CAPTCHA, rate limits, validation,
// dedupe, touchpoint, consent, deal, outbox, idempotent replay, and the
// schedule's leak check. Handlers are called with a plain Request and a fake
// env and CAPTCHA (no network). Rolled-back tests, except the one concurrency
// test, which commits and cleans up after itself. Skipped without DATABASE_URL.
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allowedOrigins,
  checkApiKey,
  defaultCaptcha,
  turnstile,
} from "../lib/public/guard.ts";
import {
  handleLead,
  handleOptions,
  handleSchedule,
} from "../lib/public/handlers.ts";
import { cleanUrl } from "../lib/public/leads.ts";
import { readSchedule, withStatementTimeout } from "../lib/public/schedule.ts";
import { createHmac } from "node:crypto";
import { normalizePhoneE164 } from "../lib/format/phone.ts";
import {
  clearReviewFlag,
  openPairFor,
} from "../lib/people/duplicate-review.ts";
import { closeDb, db, withTransaction } from "../lib/sql.ts";
import { it, newCourse, newUser } from "./seed.ts";

after(closeDb);

const KEY = "test-key-0123456789abcdef";
const ORIGIN = "https://thelead.io";
const RL_SECRET = "rl-secret-0123456789abcdef";
const ENV = {
  PUBLIC_API_KEY: KEY,
  RATE_LIMIT_SECRET: RL_SECRET,
  PUBLIC_ALLOWED_ORIGINS: ORIGIN,
  PUBLIC_WEBSITE_URL: "https://thelead.io/",
};
const captcha = async (token: string | null | undefined) => token === "good";

let n = 0;
const nextIp = () => `10.${(++n >> 8) & 255}.${n & 255}.7`;

function lead(
  body: unknown,
  o: {
    headers?: Record<string, string>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  return handleLead(
    new Request("https://crm.test/api/public/leads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "x-real-ip": nextIp(),
        ...o.headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { env: o.env ?? ENV, captcha },
  );
}
const schedule = (qs = "", headers: Record<string, string> = {}) =>
  handleSchedule(
    new Request(`https://crm.test/api/public/schedule${qs}`, {
      headers: { "x-api-key": KEY, ...headers },
    }),
    { env: ENV },
  );

const uniqueEmail = () => `${crypto.randomUUID()}@example.com`;
function uniquePhone(): string {
  for (;;) {
    const p = `012${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    if (normalizePhoneE164(p)) return p;
  }
}
const form = (o: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(),
  fullName: "Tan Mei Ling",
  email: uniqueEmail(),
  captchaToken: "good",
  ...o,
});
async function ok(res: Response) {
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as { ok: true; personId: string; dealId: string };
}
const count = async (table: string, where: string, ...args: string[]) =>
  (
    await db().unsafe(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
      args,
    )
  )[0].n as number;

// ---- Gate: key, origin, CORS (no database) ---------------------------------

test("checkApiKey: right key, wrong key, none, and a rotation list", () => {
  assert.equal(checkApiKey({ PUBLIC_API_KEY: KEY }, KEY), "ok");
  assert.equal(checkApiKey({ PUBLIC_API_KEY: KEY }, KEY + "x"), "bad");
  assert.equal(checkApiKey({ PUBLIC_API_KEY: KEY }, KEY.slice(0, -1)), "bad");
  assert.equal(checkApiKey({ PUBLIC_API_KEY: KEY }, null), "bad");
  assert.equal(checkApiKey({ PUBLIC_API_KEY: KEY }, ""), "bad");
  const rotating = { PUBLIC_API_KEY: `${KEY}, second-key-0123456789abc` };
  assert.equal(checkApiKey(rotating, "second-key-0123456789abc"), "ok");
  assert.equal(checkApiKey(rotating, KEY), "ok");
});

test("checkApiKey: unset, empty or short PUBLIC_API_KEY is closed, even for an empty header", () => {
  for (const v of [undefined, "", "   ", "short", ",,"]) {
    assert.equal(checkApiKey({ PUBLIC_API_KEY: v }, v ?? ""), "unconfigured");
    assert.equal(checkApiKey({ PUBLIC_API_KEY: v }, KEY), "unconfigured");
  }
});

test("allowedOrigins: no wildcard, https only (http for localhost), junk dropped", () => {
  assert.deepEqual(
    allowedOrigins({
      PUBLIC_ALLOWED_ORIGINS:
        "*, https://thelead.io/path, http://evil.test, http://localhost:3000, nonsense, https://www.thelead.io",
    }),
    ["https://thelead.io", "http://localhost:3000", "https://www.thelead.io"],
  );
  assert.deepEqual(allowedOrigins({}), []);
});

test("proxy matcher: /api/public/* skips the session proxy, CRM routes and other APIs do not", () => {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  // The array wraps once it holds more than a couple of exclusions, so the
  // reader cannot assume the string sits on the `matcher:` line.
  const matcher = /matcher:\s*\[\s*"([^"]+)"/.exec(src)?.[1];
  assert.ok(matcher, "matcher not found in proxy.ts");
  const re = new RegExp(`^${matcher}$`);
  for (const p of [
    "/api/public/schedule",
    "/api/public/leads",
    "/schedule",
    "/enquiry",
  ])
    assert.equal(re.test(p), false, `${p} should bypass the proxy`);
  for (const p of ["/people", "/deals", "/api/people", "/api/classes", "/"])
    assert.equal(re.test(p), true, `${p} should go through the proxy`);
});

test("proxy: the API branch never redirects to sign-in (handlers authenticate themselves)", () => {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const apiBranch = src.slice(
    src.indexOf('startsWith("/api")'),
    src.indexOf("const { data }"),
  );
  assert.match(apiBranch, /return response;/);
  assert.doesNotMatch(apiBranch, /redirect/);
});

it("key: a wrong, missing or unconfigured key is refused before anything is read", async () => {
  const wrong = await lead(form(), { headers: { "x-api-key": "nope" } });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error.code, "unauthorized");
  const none = await lead(form(), { headers: { "x-api-key": "" } });
  assert.equal(none.status, 401);
  const closed = await lead(form(), { env: { ...ENV, PUBLIC_API_KEY: "" } });
  assert.equal(closed.status, 503);
  assert.equal((await schedule("", { "x-api-key": "nope" })).status, 401);
  assert.equal(
    (
      await handleSchedule(
        new Request("https://crm.test/api/public/schedule", {
          headers: { "x-api-key": KEY },
        }),
        { env: { ...ENV, PUBLIC_API_KEY: undefined } as never },
      )
    ).status,
    503,
  );
  // Refused calls wrote nothing and are not cached.
  assert.equal(wrong.headers.get("cache-control"), "no-store");
});

it("CORS: allow-listed origin is echoed, others get 403 and no CORS headers, no Origin is fine with a key", async () => {
  const good = await lead(form(), { headers: { origin: ORIGIN } });
  assert.equal(good.status, 201);
  assert.equal(good.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(good.headers.get("vary"), "Origin");

  const evil = await lead(form(), { headers: { origin: "https://evil.test" } });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).error.code, "origin_not_allowed");
  assert.equal(evil.headers.get("access-control-allow-origin"), null);

  const evilGet = await schedule("", { origin: "https://evil.test" });
  assert.equal(evilGet.status, 403);
  assert.equal(evilGet.headers.get("access-control-allow-origin"), null);

  const wild = await lead(form(), {
    headers: { origin: "https://anything.test" },
    env: { ...ENV, PUBLIC_ALLOWED_ORIGINS: "*" },
  });
  assert.equal(wild.status, 403, "a wildcard entry allows nothing");

  const server = await lead(form());
  assert.equal(server.status, 201);
  assert.equal(server.headers.get("access-control-allow-origin"), null);
});

test("CORS preflight: answered for an allow-listed origin only", () => {
  const pre = (origin: string | null) =>
    handleOptions(
      new Request("https://crm.test/api/public/leads", {
        method: "OPTIONS",
        headers: origin ? { origin } : {},
      }),
      { env: ENV },
    );
  const good = pre(ORIGIN);
  assert.equal(good.status, 204);
  assert.equal(good.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(good.headers.get("access-control-allow-headers")!, /X-Api-Key/);
  assert.equal(pre("https://evil.test").status, 403);
  assert.equal(
    pre("https://evil.test").headers.get("access-control-allow-origin"),
    null,
  );
  assert.equal(pre(null).status, 403);
});

// ---- CAPTCHA ---------------------------------------------------------------

it("CAPTCHA: a bad or missing token is refused and nothing is written", async () => {
  const email = uniqueEmail();
  const bad = await lead(form({ email, captchaToken: "bad" }));
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).error.code, "captcha_failed");
  assert.equal((await lead(form({ email, captchaToken: null }))).status, 403);
  assert.equal(await count("person", "email_norm = $1", email), 0);
});

test("CAPTCHA default: closed with no provider; the dev switch works only outside production; Turnstile checked with a fake fetch", async () => {
  assert.equal(await defaultCaptcha({})("good", null), false);
  assert.equal(
    await defaultCaptcha({ PUBLIC_CAPTCHA_DISABLED: "yes" })(null, null),
    false,
  );
  assert.equal(
    await defaultCaptcha({ PUBLIC_CAPTCHA_DISABLED: "true" })(null, null),
    true,
  );
  assert.equal(
    await defaultCaptcha({
      PUBLIC_CAPTCHA_DISABLED: "true",
      NODE_ENV: "production",
    })(null, null),
    false,
  );

  const answer = (body: unknown, ok = true) =>
    (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  assert.equal(
    await turnstile("s", answer({ success: true }))("t", "1.2.3.4"),
    true,
  );
  assert.equal(
    await turnstile("s", answer({ success: false }))("t", null),
    false,
  );
  assert.equal(
    await turnstile("s", answer({ success: true }, false))("t", null),
    false,
  );
  assert.equal(
    await turnstile("s", answer({ success: true }))("", null),
    false,
  );
  const boom = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await turnstile("s", boom)("t", null), false);
  // What goes to the provider: the secret, the token, the IP.
  let sent = "";
  const spy = (async (_u: string, init: { body: URLSearchParams }) => {
    sent = init.body.toString();
    return { ok: true, json: async () => ({ success: true }) };
  }) as unknown as typeof fetch;
  await turnstile("sec", spy)("tok", "9.9.9.9");
  assert.equal(sent, "secret=sec&response=tok&remoteip=9.9.9.9");
});

// ---- Rate limits -----------------------------------------------------------

it("rate limit: 10 per IP per minute, the 11th is 429 with Retry-After, another IP is unaffected", async () => {
  const h = { "x-real-ip": "198.51.100.9" };
  for (let i = 0; i < 10; i++)
    assert.equal((await lead(form(), { headers: h })).status, 201);
  const over = await lead(form(), { headers: h });
  assert.equal(over.status, 429);
  assert.equal(over.headers.get("retry-after"), "60");
  assert.equal((await over.json()).error.code, "rate_limited");
  assert.equal((await lead(form())).status, 201);
  // The bucket holds a hash, never the address.
  assert.equal(
    await count("rate_limit_hit", "bucket LIKE '%198.51.100.9%'"),
    0,
  );
});

it("rate limit: the IP bucket is keyed with RATE_LIMIT_SECRET, not with the API key the browsers hold", async () => {
  const ip = "198.51.100.77";
  await ok(await lead(form(), { headers: { "x-real-ip": ip } }));
  const bucket = (k: string) =>
    `ip:${createHmac("sha256", k).update(ip).digest("hex")}`;
  assert.equal(
    await count("rate_limit_hit", "bucket = $1", bucket(RL_SECRET)),
    1,
  );
  assert.equal(await count("rate_limit_hit", "bucket = $1", bucket(KEY)), 0);
});

it("rate limit: no RATE_LIMIT_SECRET (unset, empty, short) closes the lead route with 503 and writes nothing; the schedule is unaffected", async () => {
  for (const v of [undefined, "", "   ", "short"]) {
    const email = uniqueEmail();
    const res = await lead(form({ email }), {
      env: { ...ENV, RATE_LIMIT_SECRET: v },
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "not_configured");
    assert.equal(await count("person", "email_norm = $1", email), 0);
  }
  const sched = await handleSchedule(
    new Request("https://crm.test/api/public/schedule", {
      headers: { "x-api-key": KEY },
    }),
    { env: { ...ENV, RATE_LIMIT_SECRET: undefined } },
  );
  assert.equal(sched.status, 200);
});

it("rate limit: 3 per phone per hour, counted on accepted submissions, the 4th is 429", async () => {
  const phone = uniquePhone();
  for (let i = 0; i < 3; i++) await ok(await lead(form({ phone })));
  const over = await lead(form({ phone: `+6${phone}` }));
  assert.equal(over.status, 429);
  assert.equal(over.headers.get("retry-after"), "3600");
  assert.equal((await lead(form({ phone: uniquePhone() }))).status, 201);
});

// ---- Validation ------------------------------------------------------------

it("validation: fullName and one of email/phone are all that is required", async () => {
  const none = await lead({ fullName: "A B", captchaToken: "good" });
  assert.equal(none.status, 400);
  assert.ok((await none.json()).error.fields.email);
  const noName = await lead(form({ fullName: "  " }));
  assert.equal(noName.status, 400);
  assert.ok((await noName.json()).error.fields.fullName);
  assert.equal((await lead(form({ email: "not-an-email" }))).status, 400);
  assert.equal((await lead(form({ email: null, phone: null }))).status, 400);
  // Only the name plus a phone is a lead; so is the name plus an email.
  await ok(
    await lead({
      fullName: "Phone Only",
      phone: uniquePhone(),
      captchaToken: "good",
    }),
  );
  await ok(
    await lead({
      fullName: "Mail Only",
      email: uniqueEmail(),
      captchaToken: "good",
    }),
  );
});

it("validation: length limits, wrong types, bad JSON and oversize bodies are refused", async () => {
  assert.equal((await lead(form({ fullName: "x".repeat(201) }))).status, 400);
  assert.equal((await lead(form({ message: "x".repeat(2001) }))).status, 400);
  assert.equal(
    (await lead(form({ companyName: "x".repeat(201) }))).status,
    400,
  );
  assert.equal(
    (await lead(form({ idempotencyKey: "has spaces here!" }))).status,
    400,
  );
  assert.equal((await lead(form({ consentMarketing: "true" }))).status, 400);
  assert.equal((await lead(form({ preferredLanguage: "fr" }))).status, 400);
  assert.equal(
    (await lead(form({ attribution: { utmSource: "x".repeat(201) } }))).status,
    400,
  );
  const bad = await lead("{nope");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "invalid_json");
  const big = await lead(form({ message: "ok", junk: "x".repeat(40_000) }));
  assert.equal(big.status, 413);
});

// ---- Capture: person, touchpoint, deal, outbox -----------------------------

it("lead: a minimal submission makes person, first touchpoint, new deal and one LeadCaptured", async () => {
  const email = uniqueEmail();
  const body = await ok(
    await lead(form({ email, formName: ".01 LEAD - EN - Test" })),
  );
  assert.match(body.personId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(body).sort(), ["dealId", "ok", "personId"]);

  const [p] = await db()`
    SELECT full_name, email_norm, preferred_language, first_touchpoint_id,
           last_activity_at, needs_review FROM person WHERE id = ${body.personId}`;
  assert.equal(p.email_norm, email);
  assert.equal(p.preferred_language, "en");
  assert.ok(p.last_activity_at);
  assert.equal(p.needs_review, false);

  const [t] = await db()`
    SELECT id, channel, is_first_touch, form_name FROM touchpoint
    WHERE person_id = ${body.personId}`;
  assert.equal(t.channel, "web_form");
  assert.equal(t.is_first_touch, true);
  assert.equal(t.form_name, ".01 LEAD - EN - Test");
  assert.equal(p.first_touchpoint_id, t.id);

  const [d] = await db()`
    SELECT pipeline, stage, funding_type, source_touchpoint_id, created_by
    FROM deal WHERE id = ${body.dealId}`;
  assert.equal(d.pipeline, "individual");
  assert.equal(d.stage, "new");
  assert.equal(d.funding_type, null);
  assert.equal(d.source_touchpoint_id, t.id);

  const ev = await db()`
    SELECT payload, aggregate_type, created_by FROM event_outbox
    WHERE type = 'LeadCaptured' AND aggregate_id = ${body.personId}`;
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, {
    personId: body.personId,
    dealId: body.dealId,
    formName: ".01 LEAD - EN - Test",
    touchpointId: t.id,
  });
  assert.equal(ev[0].aggregate_type, "person");
  // Creates are audited (§4), with no personal data in the audit row: no
  // email, and no IP either (audit_log is append-only and cannot be erased).
  const audits = await db()`
    SELECT after::text AS after, ip FROM audit_log
    WHERE entity_id IN (${body.personId}, ${body.dealId})`;
  assert.equal(audits.length, 2);
  for (const a of audits) {
    assert.ok(!a.after.includes(email));
    assert.equal(a.ip, null);
  }
});

it("lead: the same email (any case) or the same phone (any format) finds the existing person", async () => {
  const email = uniqueEmail();
  const phone = uniquePhone();
  const first = await ok(
    await lead(form({ email, phone, fullName: "Lim Ah Kow" })),
  );

  const byEmail = await ok(
    await lead(form({ email: email.toUpperCase(), fullName: "Someone Else" })),
  );
  assert.equal(byEmail.personId, first.personId);

  const byPhone = await ok(
    await lead(
      form({
        email: uniqueEmail(),
        phone: `+6${phone}`,
        fullName: "Other Name",
      }),
    ),
  );
  assert.equal(byPhone.personId, first.personId);
  assert.equal(
    await count("person", "phone_e164 = $1", normalizePhoneE164(phone)!),
    1,
  );
  // Later touchpoints are not first touches; one first touch per person.
  assert.equal(await count("touchpoint", "person_id = $1", first.personId), 3);
  assert.equal(
    await count(
      "touchpoint",
      "person_id = $1 AND is_first_touch",
      first.personId,
    ),
    1,
  );
  // The existing person's name is not rewritten by a public form.
  const [p] =
    await db()`SELECT full_name FROM person WHERE id = ${first.personId}`;
  assert.equal(p.full_name, "Lim Ah Kow");
});

it("lead: phone is normalised (§4), an unnormalisable one is kept and flagged", async () => {
  const typed = "012-345 6789";
  const a = await ok(await lead(form({ phone: typed })));
  const [p] =
    await db()`SELECT phone, phone_e164, whatsapp_e164 FROM person WHERE id = ${a.personId}`;
  // Seeded data may already own this number; then the lead attached to it.
  assert.equal(p.phone_e164, "+60123456789");
  assert.equal(p.whatsapp_e164, "+60123456789");

  const junk = await ok(await lead(form({ email: null, phone: "call me" })));
  const [j] = await db()`
    SELECT phone, phone_e164, needs_review, needs_review_reason FROM person WHERE id = ${junk.personId}`;
  assert.equal(j.phone, "call me");
  assert.equal(j.phone_e164, null);
  assert.equal(j.needs_review, true);
  assert.equal(j.needs_review_reason, "phone_unnormalised");
});

it("lead: same name and last 7 phone digits at a different number is created, flagged for review (soft match)", async () => {
  const phone = uniquePhone();
  const other = `011${phone.slice(3)}`;
  if (!normalizePhoneE164(other)) return; // number plan rejected the sibling
  const first = await ok(await lead(form({ phone, fullName: "Ng Siew Lan" })));
  const second = await ok(
    await lead(
      form({ email: uniqueEmail(), phone: other, fullName: "NG SIEW-LAN" }),
    ),
  );
  assert.notEqual(second.personId, first.personId);
  const [p] =
    await db()`SELECT needs_review_reason FROM person WHERE id = ${second.personId}`;
  assert.equal(p.needs_review_reason, "possible_duplicate_phone");

  // Same as POST /api/people (1758c22): the flag comes with the §7.1 pair, in
  // the same transaction, so §9.2 can name the other record and §9.3 can open.
  const tasks = await db()`
    SELECT person_id, related_person_id, created_by, done_at FROM task
    WHERE type = 'review_duplicate' AND person_id = ${second.personId}`;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].related_person_id, first.personId);
  assert.equal(tasks[0].created_by, null);
  assert.equal(tasks[0].done_at, null);
  assert.equal((await openPairFor(second.personId))?.id, first.personId);
  const [audit] = await db()`
    SELECT a.user_id FROM audit_log a JOIN task t ON t.id = a.entity_id
    WHERE a.entity = 'task' AND t.person_id = ${second.personId}`;
  assert.equal(audit.user_id, null);

  // And the exit works on a person the form created: not a duplicate.
  const admin = await newUser("super_admin");
  const [v] =
    await db()`SELECT version::int AS v FROM person WHERE id = ${second.personId}`;
  assert.equal(
    (await clearReviewFlag(second.personId, "different people", v.v, admin))
      .kind,
    "dismissed",
  );
  const [after] = await db()`
    SELECT p.needs_review, (SELECT count(*) FROM task t WHERE t.type = 'review_duplicate' AND t.person_id = p.id AND t.done_at IS NULL)::int AS open
    FROM person p WHERE p.id = ${second.personId}`;
  assert.equal(after.needs_review, false);
  assert.equal(after.open, 0);
});

it("lead: an open deal for the same course is reused; a different course, or a closed deal, gets a new one", async () => {
  const [aia] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`AIA${crypto.randomUUID().slice(0, 6)}`}, 'A', 'workshop', 1) RETURNING id, code`;
  const [other] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`OTH${crypto.randomUUID().slice(0, 6)}`}, 'B', 'workshop', 1) RETURNING id, code`;
  const email = uniqueEmail();

  const one = await ok(await lead(form({ email, courseInterest: aia.code })));
  const [d1] = await db()`SELECT course_id FROM deal WHERE id = ${one.dealId}`;
  assert.equal(d1.course_id, aia.id);

  const again = await ok(
    await lead(form({ email, courseInterest: aia.code.toLowerCase() })),
  );
  assert.equal(again.dealId, one.dealId);
  assert.equal(await count("deal", "person_id = $1", one.personId), 1);
  // Each submission is still a lead event of its own, pointing at that deal.
  const events = await db()`
    SELECT payload->>'dealId' AS deal_id FROM event_outbox
    WHERE type = 'LeadCaptured' AND aggregate_id = ${one.personId}`;
  assert.deepEqual(
    events.map((e) => e.deal_id),
    [one.dealId, one.dealId],
  );

  const diff = await ok(
    await lead(form({ email, courseInterest: other.code })),
  );
  assert.notEqual(diff.dealId, one.dealId);

  const noCourse = await ok(await lead(form({ email })));
  assert.notEqual(noCourse.dealId, one.dealId);
  assert.notEqual(noCourse.dealId, diff.dealId);
  const noCourse2 = await ok(await lead(form({ email })));
  assert.equal(noCourse2.dealId, noCourse.dealId);

  // Lost deals are not open (§12.5 needs a reason and timestamp).
  const [reason] = await db()`SELECT id FROM lost_reason LIMIT 1`;
  await db()`
    UPDATE deal SET stage = 'lost', lost_at = now(), lost_reason_id = ${reason.id}
    WHERE id = ${one.dealId}`;
  const revived = await ok(
    await lead(form({ email, courseInterest: aia.code })),
  );
  assert.notEqual(revived.dealId, one.dealId);
});

it("lead: hrdcIntended true makes the new deal funding_type 'hrdc'; absent or false leaves it empty", async () => {
  const yes = await ok(await lead(form({ hrdcIntended: true })));
  const no = await ok(await lead(form({ hrdcIntended: false })));
  const dflt = await ok(await lead(form()));
  const f = async (id: string) =>
    (await db()`SELECT funding_type FROM deal WHERE id = ${id}`)[0]
      .funding_type;
  assert.equal(await f(yes.dealId), "hrdc");
  assert.equal(await f(no.dealId), null);
  assert.equal(await f(dflt.dealId), null);
});

it("lead: classCode sets class and course on the deal; an unknown code or course is ignored, not an error", async () => {
  const courseId = await newCourse();
  const code = `K-${crypto.randomUUID().slice(0, 8)}`;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
      venue_name, venue_address, city, capacity, status, is_public)
    VALUES (${courseId}, ${code}, current_date + 5, current_date + 5, 'en',
      'in_person', 'V', 'A', 'KL', 10, 'open', true) RETURNING id`;
  const r = await ok(await lead(form({ classCode: code })));
  const [d] =
    await db()`SELECT course_id, class_id FROM deal WHERE id = ${r.dealId}`;
  assert.equal(d.class_id, c.id);
  assert.equal(d.course_id, courseId);

  const unknown = await ok(
    await lead(form({ classCode: "NOPE-1", courseInterest: "NOPE" })),
  );
  const [u] =
    await db()`SELECT course_id, class_id FROM deal WHERE id = ${unknown.dealId}`;
  assert.equal(u.course_id, null);
  assert.equal(u.class_id, null);
});

it("lead: a classCode of a private, draft, cancelled or completed class attaches no class; the lead and the course interest are kept", async () => {
  const courseId = await newCourse();
  const [course] = await db()`SELECT code FROM course WHERE id = ${courseId}`;
  const mk = async (status: string, isPublic: boolean) => {
    const code = `X-${crypto.randomUUID().slice(0, 8)}`;
    await db()`
      INSERT INTO class (course_id, code, start_date, end_date, language, mode,
        venue_name, venue_address, city, capacity, status, is_public)
      VALUES (${courseId}, ${code}, current_date + 5, current_date + 5, 'en',
        'in_person', 'V', 'A', 'KL', 10, ${status}, ${isPublic})`;
    return code;
  };
  for (const [status, isPublic] of [
    ["open", false],
    ["draft", true],
    ["cancelled", true],
    ["completed", true],
  ] as const) {
    const code = await mk(status, isPublic);
    const r = await ok(
      await lead(form({ classCode: code, courseInterest: course.code })),
    );
    const [d] =
      await db()`SELECT course_id, class_id FROM deal WHERE id = ${r.dealId}`;
    assert.equal(d.class_id, null, `${status} public=${isPublic}`);
    assert.equal(d.course_id, courseId);
  }
  // A public full class still takes a lead (a waiting-list enquiry).
  const full = await mk("full", true);
  const r = await ok(await lead(form({ classCode: full })));
  const [d] = await db()`SELECT class_id FROM deal WHERE id = ${r.dealId}`;
  assert.ok(d.class_id);
});

it("lead: the message is appended to the person's notes without overwriting them", async () => {
  const email = uniqueEmail();
  const a = await ok(
    await lead(form({ email, message: "Is this HRDC claimable?" })),
  );
  await db()`UPDATE person SET notes = notes || E'\nstaff note' WHERE id = ${a.personId}`;
  await ok(await lead(form({ email, message: "Second question" })));
  const [p] = await db()`SELECT notes FROM person WHERE id = ${a.personId}`;
  assert.match(
    p.notes,
    /Is this HRDC claimable\?\nstaff note\n.*Second question/,
  );
});

// ---- Consent ---------------------------------------------------------------

it("consent: ticked grants email and WhatsApp marketing once, with a ConsentChanged each; unticked records nothing and withdraws nothing", async () => {
  const email = uniqueEmail();
  const no = await ok(await lead(form({ email, consentMarketing: false })));
  assert.equal(await count("consent", "person_id = $1", no.personId), 0);
  assert.equal(
    await count(
      "event_outbox",
      "type = 'ConsentChanged' AND aggregate_id = $1",
      no.personId,
    ),
    0,
  );
  // The lead is still captured without consent (§10.3).
  assert.equal(await count("deal", "person_id = $1", no.personId), 1);

  await ok(await lead(form({ email, consentMarketing: true })));
  const rows = await db()`
    SELECT purpose, is_granted, source FROM consent
    WHERE person_id = ${no.personId} ORDER BY purpose`;
  assert.deepEqual(
    rows.map((r) => [r.purpose, r.is_granted, r.source]),
    [
      ["marketing_email", true, "web_form"],
      ["marketing_whatsapp", true, "web_form"],
    ],
  );
  await ok(await lead(form({ email, consentMarketing: true })));
  assert.equal(await count("consent", "person_id = $1", no.personId), 2);
  await ok(await lead(form({ email, consentMarketing: false })));
  assert.equal(await count("consent", "person_id = $1", no.personId), 2);
  assert.equal(
    await count(
      "event_outbox",
      "type = 'ConsentChanged' AND aggregate_id = $1",
      no.personId,
    ),
    2,
  );
});

it("consent: a withdrawn purpose is not granted again from the public form; the lead is still captured (O45)", async () => {
  const email = uniqueEmail();
  const first = await ok(await lead(form({ email, consentMarketing: true })));
  // The person withdraws email marketing later (appended, never edited).
  await db()`
    INSERT INTO consent (person_id, purpose, is_granted, source, recorded_at)
    VALUES (${first.personId}, 'marketing_email', false, 'staff',
            now() + interval '1 hour')`;
  const events = () =>
    count(
      "event_outbox",
      "type = 'ConsentChanged' AND aggregate_id = $1",
      first.personId,
    );
  const rowsBefore = await count("consent", "person_id = $1", first.personId);
  const eventsBefore = await events();

  const again = await ok(await lead(form({ email, consentMarketing: true })));
  assert.equal(again.personId, first.personId);
  // Lead captured: new touchpoint and a LeadCaptured for it.
  assert.equal(await count("touchpoint", "person_id = $1", first.personId), 2);
  assert.equal(
    await count(
      "event_outbox",
      "type = 'LeadCaptured' AND aggregate_id = $1",
      first.personId,
    ),
    2,
  );
  // But no new consent row and no ConsentChanged; WhatsApp (still granted) is
  // unchanged too.
  assert.equal(
    await count("consent", "person_id = $1", first.personId),
    rowsBefore,
  );
  assert.equal(await events(), eventsBefore);
  const [latest] = await db()`
    SELECT is_granted FROM consent
    WHERE person_id = ${first.personId} AND purpose = 'marketing_email'
    ORDER BY recorded_at DESC LIMIT 1`;
  assert.equal(latest.is_granted, false);
});

// ---- Company, attribution --------------------------------------------------

it("company: stored as typed, linked only to one existing match, never created", async () => {
  const name = `Acme${crypto.randomUUID().slice(0, 8).replace(/\d/g, "x")}`;
  const [co] = await db()`
    INSERT INTO company (legal_name) VALUES (${`${name} Sdn. Bhd.`}) RETURNING id`;
  const before = await count("company", "true");

  const hit = await ok(await lead(form({ companyName: `${name} (M) Berhad` })));
  const [p] =
    await db()`SELECT company_name_given FROM person WHERE id = ${hit.personId}`;
  assert.equal(p.company_name_given, `${name} (M) Berhad`);
  assert.equal(
    await count(
      "company_membership",
      "person_id = $1 AND company_id = $2 AND end_date IS NULL",
      hit.personId,
      co.id,
    ),
    1,
  );

  const miss = await ok(
    await lead(form({ companyName: "No Such Company Pte" })),
  );
  assert.equal(
    await count("company_membership", "person_id = $1", miss.personId),
    0,
  );
  assert.equal(await count("company", "true"), before);
});

it("attribution: utm fields stored; landing URL kept only from our origins and stripped of other query parameters", async () => {
  const r = await ok(
    await lead(
      form({
        attribution: {
          utmSource: "facebook",
          utmMedium: "paid_social",
          utmCampaign: "agentic_202610_leads_en",
          utmContent: "vid_a",
          fbclid: "IwAR1",
          landingUrl:
            "https://thelead.io/lp/agentic?utm_source=facebook&email=a%40b.com&phone=0123#frag",
          referrer: "https://facebook.com/?token=secret",
        },
      }),
    ),
  );
  const [t] = await db()`
    SELECT utm_source, utm_medium, utm_campaign, utm_content, fbclid,
           landing_url, referrer FROM touchpoint WHERE person_id = ${r.personId}`;
  assert.equal(t.utm_source, "facebook");
  assert.equal(t.utm_campaign, "agentic_202610_leads_en");
  assert.equal(t.fbclid, "IwAR1");
  assert.equal(
    t.landing_url,
    "https://thelead.io/lp/agentic?utm_source=facebook",
  );
  assert.equal(t.referrer, "https://facebook.com/");

  // A landing URL on someone else's origin is not trusted; the Referer header is.
  const spoof = await ok(
    await lead(
      form({ attribution: { landingUrl: "https://evil.test/x?utm_source=a" } }),
      {
        headers: { referer: "https://thelead.io/contact?name=Ali" },
      },
    ),
  );
  const [s] =
    await db()`SELECT landing_url FROM touchpoint WHERE person_id = ${spoof.personId}`;
  assert.equal(s.landing_url, "https://thelead.io/contact");

  const none = await ok(
    await lead(form({ attribution: { landingUrl: "javascript:alert(1)" } })),
  );
  const [z] =
    await db()`SELECT landing_url FROM touchpoint WHERE person_id = ${none.personId}`;
  assert.equal(z.landing_url, null);
});

test("cleanUrl: path and utm_*/gclid/fbclid only; credentials, fragments and non-http dropped", () => {
  assert.equal(
    cleanUrl("https://u:p@x.test/a/b?gclid=1&q=x&utm_term=y#h"),
    "https://x.test/a/b?gclid=1&utm_term=y",
  );
  assert.equal(cleanUrl("ftp://x.test/"), null);
  assert.equal(cleanUrl("not a url"), null);
  assert.equal(cleanUrl(null), null);
  assert.ok(cleanUrl(`https://x.test/${"a".repeat(900)}`)!.length <= 500);
});

it("attribution: a first-touch cookie from earlier becomes the first touch; this submission is a later touch", async () => {
  const r = await ok(
    await lead(
      form({
        attribution: {
          utmSource: "facebook",
          utmCampaign: "paid",
          firstTouch: {
            utmSource: "youtube",
            utmCampaign: "organic",
            occurredAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          },
        },
      }),
    ),
  );
  const rows = await db()`
    SELECT id, utm_source, is_first_touch, occurred_at FROM touchpoint
    WHERE person_id = ${r.personId} ORDER BY occurred_at`;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].utm_source, "youtube");
  assert.equal(rows[0].is_first_touch, true);
  assert.equal(rows[1].utm_source, "facebook");
  assert.equal(rows[1].is_first_touch, false);
  const [p] =
    await db()`SELECT first_touchpoint_id FROM person WHERE id = ${r.personId}`;
  assert.equal(p.first_touchpoint_id, rows[0].id);

  // A client-sent time in the future is not believed.
  const fut = await ok(
    await lead(
      form({
        attribution: {
          utmSource: "a",
          firstTouch: {
            utmSource: "b",
            occurredAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
          },
        },
      }),
    ),
  );
  const [f] = await db()`
    SELECT max(occurred_at) <= now() + interval '1 minute' AS sane
    FROM touchpoint WHERE person_id = ${fut.personId}`;
  assert.equal(f.sane, true);
});

it("attribution: a first-touch cookie without a usable time makes no synthetic touch; this submission stays the first touch", async () => {
  const cookie = (occurredAt?: string) =>
    form({
      attribution: {
        utmSource: "facebook",
        utmCampaign: "paid",
        firstTouch: {
          utmSource: "youtube",
          utmCampaign: "organic",
          occurredAt,
        },
      },
    });
  for (const at of [
    undefined,
    "garbage",
    new Date(Date.now() + 9 * 86_400_000).toISOString(),
  ]) {
    const r = await ok(await lead(cookie(at)));
    const rows = await db()`
      SELECT id, utm_source, is_first_touch FROM touchpoint WHERE person_id = ${r.personId}`;
    assert.equal(rows.length, 1, String(at));
    assert.equal(rows[0].utm_source, "facebook");
    assert.equal(rows[0].is_first_touch, true);
    const [p] =
      await db()`SELECT first_touchpoint_id FROM person WHERE id = ${r.personId}`;
    assert.equal(p.first_touchpoint_id, rows[0].id);
  }
});

it("attribution: the cookie's touch is never later than the submission and does not count toward 3 per phone per hour", async () => {
  const phone = uniquePhone();
  const withCookie = (at: Date) =>
    form({
      phone,
      attribution: {
        utmSource: "facebook",
        utmCampaign: "paid",
        firstTouch: {
          utmSource: "youtube",
          utmCampaign: "organic",
          occurredAt: at.toISOString(),
        },
      },
    });
  // 30 s "in the future" is tolerated (clock skew) but must not sort after
  // the submission itself.
  const first = await ok(await lead(withCookie(new Date(Date.now() + 30_000))));
  const rows = await db()`
    SELECT utm_source, is_first_touch, occurred_at FROM touchpoint
    WHERE person_id = ${first.personId} ORDER BY is_first_touch DESC`;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].utm_source, "youtube");
  assert.ok(rows[0].occurred_at <= rows[1].occurred_at);
  // Two more submissions inside the hour are still the 2nd and 3rd; only the
  // 4th is refused. (The cookie's visit, 10 minutes ago, is not a submission.)
  const recent = new Date(Date.now() - 10 * 60_000);
  await ok(await lead(withCookie(recent)));
  await ok(await lead(withCookie(recent)));
  assert.equal((await lead(withCookie(recent))).status, 429);
});

// ---- Idempotency -----------------------------------------------------------

it("idempotency: a repeat key returns the same ids and changes nothing — one person, touchpoint, deal, consent, LeadCaptured", async () => {
  const key = crypto.randomUUID();
  const body = form({
    idempotencyKey: key,
    consentMarketing: true,
    hrdcIntended: true,
  });
  const first = await ok(await lead(body));
  const second = await ok(await lead(body));
  const third = await ok(await lead({ ...body, captchaToken: "spent" }));
  assert.deepEqual(second, first);
  assert.deepEqual(
    third,
    first,
    "a replay does not need a fresh CAPTCHA token",
  );

  assert.equal(await count("touchpoint", "person_id = $1", first.personId), 1);
  assert.equal(await count("deal", "person_id = $1", first.personId), 1);
  assert.equal(await count("consent", "person_id = $1", first.personId), 2);
  assert.equal(
    await count(
      "event_outbox",
      "type = 'LeadCaptured' AND aggregate_id = $1",
      first.personId,
    ),
    1,
  );
  assert.equal(
    await count(
      "event_outbox",
      "type = 'ConsentChanged' AND aggregate_id = $1",
      first.personId,
    ),
    2,
  );
  assert.equal(await count("audit_log", "entity_id = $1", first.personId), 1);
});

it("idempotency: a replay of a call that joined an existing open deal answers with that deal", async () => {
  const email = uniqueEmail();
  const opener = await ok(await lead(form({ email })));
  const key = crypto.randomUUID();
  const joined = await ok(await lead(form({ email, idempotencyKey: key })));
  assert.equal(joined.dealId, opener.dealId);
  const replay = await ok(await lead(form({ email, idempotencyKey: key })));
  assert.deepEqual(replay, joined);
  assert.equal(
    await count(
      "event_outbox",
      "type = 'LeadCaptured' AND aggregate_id = $1",
      opener.personId,
    ),
    2,
  );
});

it("idempotency: a replay does not use up the phone limit; a call without a key is simply a new submission", async () => {
  const phone = uniquePhone();
  const key = crypto.randomUUID();
  for (let i = 0; i < 6; i++)
    await ok(await lead(form({ phone, idempotencyKey: key })));
  assert.equal(
    await count(
      "touchpoint",
      "channel = 'web_form' AND external_ref = $1",
      key,
    ),
    1,
  );
  const a = await ok(await lead(form({ idempotencyKey: null })));
  const b = await ok(await lead(form({ idempotencyKey: null })));
  assert.notEqual(a.personId, b.personId);
});

// ---- Failure handling --------------------------------------------------------

it("failure: an internal error is a generic 500 and the log holds no personal data", async () => {
  const logged: unknown[][] = [];
  const spy = mock.method(console, "error", (...a: unknown[]) => {
    logged.push(a);
  });
  const email = uniqueEmail();
  try {
    // A NUL byte passes validation but Postgres refuses it in text.
    const res = await lead(form({ email, fullName: "Secret\u0000Name" }));
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes("Secret"));
    assert.ok(logged.length >= 1);
    const flat = JSON.stringify(logged);
    assert.ok(!flat.includes("Secret"), flat);
    assert.ok(!flat.includes(email), flat);
  } finally {
    spy.mock.restore();
  }
});

it("failure: a database error before the capture (rate limit) is the same generic 500 with CORS and no-store headers", async () => {
  const logged: unknown[][] = [];
  const spy = mock.method(console, "error", (...a: unknown[]) => {
    logged.push(a);
  });
  try {
    // The first thing the route does with the database is the IP counter.
    await db()`DROP FUNCTION rate_limit_take(text, integer)`; // rolled back
    const email = uniqueEmail();
    const res = await lead(form({ email }), { headers: { origin: ORIGIN } });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, "server_error");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.ok(logged.length >= 1);
    assert.ok(!JSON.stringify(logged).includes(email));
  } finally {
    spy.mock.restore();
  }
});

// ---- Committed: concurrent calls ---------------------------------------------

// Removes what a committed test left behind (the append-only tables and their
// foreign keys need the replica role, as purge.ts does).
async function purgeLead(email: string) {
  const [p] = await db()`SELECT id FROM person WHERE email_norm = ${email}`;
  if (p) {
    await db().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`DELETE FROM event_outbox WHERE aggregate_id = ${p.id}`;
      await tx`DELETE FROM consent WHERE person_id = ${p.id}`;
      await tx`DELETE FROM deal WHERE person_id = ${p.id}`;
      await tx`DELETE FROM touchpoint WHERE person_id = ${p.id}`;
      await tx`DELETE FROM person WHERE id = ${p.id}`;
    });
  }
  await db()`DELETE FROM rate_limit_hit`;
}

test(
  "idempotency under concurrency: two simultaneous calls with one key give one result and one LeadCaptured (committed, cleaned up)",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    const email = uniqueEmail();
    const body = form({
      email,
      idempotencyKey: crypto.randomUUID(),
      consentMarketing: true,
    });
    let personId: string | undefined;
    try {
      const results = await Promise.all([lead(body), lead(body), lead(body)]);
      const bodies = await Promise.all(results.map((r) => r.json()));
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201, 201],
        JSON.stringify(bodies),
      );
      personId = bodies[0].personId;
      assert.equal(bodies[1].personId, personId);
      assert.equal(bodies[2].dealId, bodies[0].dealId);
      assert.equal(await count("person", "email_norm = $1", email), 1);
      assert.equal(await count("touchpoint", "person_id = $1", personId!), 1);
      assert.equal(await count("deal", "person_id = $1", personId!), 1);
      assert.equal(
        await count(
          "event_outbox",
          "type = 'LeadCaptured' AND aggregate_id = $1",
          personId!,
        ),
        1,
      );
    } finally {
      await purgeLead(email);
    }
  },
);

test(
  "idempotency under concurrency: a CAPTCHA token that works once does not fail the loser of a same-key race (committed, cleaned up)",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    // Like Turnstile: a token is good for one check only.
    const spent = new Set<string>();
    const once = async (token: string | null | undefined) => {
      if (!token || spent.has(token)) return false;
      spent.add(token);
      await new Promise((r) => setTimeout(r, 30));
      return true;
    };
    const email = uniqueEmail();
    const body = form({
      email,
      idempotencyKey: crypto.randomUUID(),
      captchaToken: "one-use-token",
    });
    const call = () =>
      handleLead(
        new Request("https://crm.test/api/public/leads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": KEY,
            "x-real-ip": nextIp(),
          },
          body: JSON.stringify(body),
        }),
        { env: ENV, captcha: once },
      );
    try {
      const results = await Promise.all([call(), call(), call()]);
      const bodies = await Promise.all(results.map((r) => r.json()));
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201, 201],
        JSON.stringify(bodies),
      );
      assert.equal(bodies[1].personId, bodies[0].personId);
      assert.equal(bodies[2].dealId, bodies[0].dealId);
      assert.equal(await count("person", "email_norm = $1", email), 1);
      assert.equal(
        await count("touchpoint", "person_id = $1", bodies[0].personId),
        1,
      );
    } finally {
      await purgeLead(email);
    }
  },
);

test(
  "concurrency: simultaneous submissions (different keys) for one existing person and course open one deal (committed, cleaned up)",
  { skip: !process.env.DATABASE_URL && "no DATABASE_URL" },
  async () => {
    const email = uniqueEmail();
    try {
      const first = await ok(await lead(form({ email })));
      const results = await Promise.all(
        [1, 2, 3, 4, 5, 6, 7, 8].map(() => lead(form({ email }))),
      );
      const bodies = await Promise.all(results.map((r) => r.json()));
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201, 201, 201, 201, 201, 201, 201],
        JSON.stringify(bodies),
      );
      for (const b of bodies) assert.equal(b.dealId, first.dealId);
      assert.equal(await count("deal", "person_id = $1", first.personId), 1);
      assert.equal(
        await count("touchpoint", "person_id = $1", first.personId),
        9,
      );
    } finally {
      await purgeLead(email);
    }
  },
);

// ---- Schedule (§8.1) -------------------------------------------------------

type Seed = {
  code: string;
  start?: string; // SQL date expression
  status?: string;
  isPublic?: boolean;
  language?: string;
  mode?: string;
  price?: string | null;
  capacity?: number;
  noTime?: boolean;
};
async function seedClass(courseId: string, city: string, s: Seed) {
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, start_time,
      end_time, language, mode, venue_name, venue_address, city, online_url,
      capacity, price_myr, status, is_public, notes, trainer_user_ids,
      hrdc_claimable)
    VALUES (${courseId}, ${s.code},
      ${db().unsafe(s.start ?? "(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 10")},
      ${db().unsafe(s.start ?? "(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 10")},
      ${s.noTime ? null : "09:00"}, ${s.noTime ? null : "17:00"}, ${s.language ?? "en"}, ${s.mode ?? "in_person"},
      ${s.mode === "online" ? null : "AI365 Hub, Oval Damansara"},
      ${s.mode === "online" ? null : "1 Jalan Rahsia"}, ${city},
      ${s.mode === "in_person" || !s.mode ? null : "https://secret.example/zoom/ROOM-99"},
      ${s.capacity ?? 7919}, ${s.price === undefined ? "3200" : s.price},
      ${s.status ?? "open"}, ${s.isPublic ?? true}, 'INTERNAL-NOTE-XYZ',
      ARRAY[${TRAINER_ID}]::uuid[], true)
    RETURNING id`;
  return c.id as string;
}
let TRAINER_ID = "";
async function scheduleFixture() {
  const trainer = await newUser("operations");
  TRAINER_ID = trainer.id;
  await db()`UPDATE app_user SET full_name = 'Secret Trainer Name' WHERE id = ${trainer.id}`;
  const [course] = await db()`
    INSERT INTO course (code, name_en, name_zh, track, duration_days, list_price_myr, hrdc_claimable)
    VALUES (${`SC-${crypto.randomUUID().slice(0, 6)}`}, 'AI Agentic Automation',
            '人工智能自动化', 'certification', 2, 4100, true) RETURNING id`;
  return {
    course: course.id as string,
    city: `Testville-${crypto.randomUUID().slice(0, 8)}`,
  };
}
const KL_TODAY = "(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date";

it("schedule: only public open/few_seats/full classes from today (Malaysia date) on, sorted, with the spec's shape and labels", async () => {
  const { course, city } = await scheduleFixture();
  const sfx = crypto.randomUUID().slice(0, 6);
  const mk = (code: string, s: Partial<Seed> = {}) =>
    seedClass(course, city, { ...s, code: `${code}-${sfx}` });
  await mk("LATE", { start: `${KL_TODAY} + 30` });
  await mk("FEW", { start: `${KL_TODAY} + 5`, capacity: 3 });
  const full = await mk("FULL", { start: `${KL_TODAY} + 6`, capacity: 1 });
  await db()`INSERT INTO enrolment (person_id, class_id, status)
             SELECT id, ${full}, 'confirmed' FROM person LIMIT 1`;
  await mk("TODAY", { start: KL_TODAY });
  await mk("OPEN", { start: `${KL_TODAY} + 2` });
  await mk("YESTERDAY", { start: `${KL_TODAY} - 1` });
  await mk("DRAFT", { status: "draft" });
  await mk("CANCELLED", { status: "cancelled" });
  await mk("DONE", { status: "completed" });
  await mk("HIDDEN", { isPublic: false });

  const res = await schedule(`?city=${encodeURIComponent(city.toUpperCase())}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=300");
  const body = await res.json();
  assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));
  assert.deepEqual(
    body.classes.map((c: { code: string }) => c.code.replace(`-${sfx}`, "")),
    ["TODAY", "OPEN", "FEW", "FULL", "LATE"],
  );
  assert.deepEqual(
    body.classes.map((c: { seatsLabel: string }) => c.seatsLabel),
    ["available", "available", "few_seats", "full", "available"],
  );

  const c = body.classes[1];
  assert.deepEqual(Object.keys(c).sort(), [
    "city",
    "code",
    "courseName",
    "endDate",
    "endTime",
    "hrdcClaimable",
    "id",
    "language",
    "mode",
    "priceMyr",
    "registerUrl",
    "seatsLabel",
    "startDate",
    "startTime",
    "track",
    "venueName",
  ]);
  assert.equal(c.courseName, "AI Agentic Automation");
  assert.equal(c.track, "certification");
  assert.equal(c.startTime, "09:00");
  assert.equal(c.endTime, "17:00");
  assert.match(c.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.priceMyr, "3200.00");
  assert.equal(c.hrdcClaimable, true);
  assert.equal(c.venueName, "AI365 Hub, Oval Damansara");
  assert.equal(c.city, city);
  assert.equal(
    c.registerUrl,
    `https://thelead.io/register/${encodeURIComponent(c.code)}`,
  );
});

it("schedule: a class with no time is listed with startTime and endTime null, not dropped or blank", async () => {
  const { course, city } = await scheduleFixture();
  const code = `NOTIME-${crypto.randomUUID().slice(0, 6)}`;
  await seedClass(course, city, { code, noTime: true });
  const res = await schedule(`?city=${encodeURIComponent(city)}`);
  assert.equal(res.status, 200);
  const [c] = (await res.json()).classes;
  assert.equal(c.code, code);
  assert.equal(c.startTime, null);
  assert.equal(c.endTime, null);
});

it("readSchedule: the in-process feed gives exactly what the route gives, with no key, and the same leak-free fields", async () => {
  const { course, city } = await scheduleFixture();
  const sfx = crypto.randomUUID().slice(0, 6);
  await seedClass(course, city, { code: `RS1-${sfx}`, mode: "online" });
  await seedClass(course, city, { code: `RS2-${sfx}`, noTime: true });

  const viaRoute = await (
    await schedule(`?city=${encodeURIComponent(city)}`)
  ).json();
  // No PUBLIC_API_KEY in this env: the in-process call needs none.
  const direct = await readSchedule(
    { PUBLIC_WEBSITE_URL: ENV.PUBLIC_WEBSITE_URL },
    { city },
  );
  assert.deepEqual(direct.classes, viaRoute.classes);
  assert.equal(direct.classes.length, 2);
  assert.ok(!Number.isNaN(Date.parse(direct.generatedAt)));
  for (const c of direct.classes)
    assert.match(c.registerUrl ?? "", /^https:\/\/thelead\.io\/register\//);
  const raw = JSON.stringify(direct);
  for (const needle of [
    "secret.example",
    "online_url",
    "INTERNAL-NOTE",
    "7919",
  ])
    assert.ok(!raw.includes(needle), needle);
  // The route's validation still applies: a bad filter throws, not a page of junk.
  await assert.rejects(() =>
    // @ts-expect-error a bad filter must stay a type error, not just a throw
    readSchedule({}, { track: "bootcamp" }),
  );
  // No website URL configured: registerUrl is null, as in the route.
  const none = await readSchedule({}, { city });
  assert.ok(none.classes.every((c) => c.registerUrl === null));
});

it("withStatementTimeout cuts a slow query off with 57014, and the setting does not outlive the transaction", async () => {
  const before = (await db()`SHOW statement_timeout`)[0].statement_timeout;
  await assert.rejects(
    () => withStatementTimeout(150, () => db()`SELECT pg_sleep(3)`),
    (e: { code?: string }) => e.code === "57014",
  );
  // A call that finishes in time returns its value.
  assert.equal(
    await withStatementTimeout(
      2000,
      async () => (await db()`SELECT 1 AS n`)[0].n,
    ),
    1,
  );
  const after = (await db()`SHOW statement_timeout`)[0].statement_timeout;
  assert.equal(after, before);
});

it("withStatementTimeout inside an outer transaction puts the outer's own setting back, not the default", async () => {
  await withTransaction(async () => {
    // A value that is not the pool default, so restoring "the default" would fail.
    await db()`SELECT set_config('statement_timeout', '30s', true)`;
    const outer = (await db()`SHOW statement_timeout`)[0].statement_timeout;
    assert.equal(outer, "30s");
    await withStatementTimeout(150, () => db()`SELECT 1`);
    assert.equal(
      (await db()`SHOW statement_timeout`)[0].statement_timeout,
      outer,
    );
    // And an error inside rolls the setting back to the outer's value too.
    await assert.rejects(() =>
      withStatementTimeout(150, () => db()`SELECT pg_sleep(3)`),
    );
    assert.equal(
      (await db()`SHOW statement_timeout`)[0].statement_timeout,
      outer,
    );
  });
});

it("schedule leak check: the serialised body never carries online_url, trainers, internal notes or seat counts", async () => {
  const { course, city } = await scheduleFixture();
  const sfx = crypto.randomUUID().slice(0, 6);
  // online and hybrid classes carry an online_url; every class has a trainer,
  // notes and an odd capacity. Some seats are taken, so a count would exist.
  await seedClass(course, city, { code: `ONL-${sfx}`, mode: "online" });
  await seedClass(course, city, { code: `HYB-${sfx}`, mode: "hybrid" });
  const inPerson = await seedClass(course, city, {
    code: `INP-${sfx}`,
    capacity: 7919,
  });
  await db()`INSERT INTO enrolment (person_id, class_id, status)
             SELECT id, ${inPerson}, 'confirmed' FROM person LIMIT 4`;

  const res = await schedule(`?city=${encodeURIComponent(city)}`);
  const raw = await res.text();
  assert.equal(JSON.parse(raw).classes.length, 3);
  for (const needle of [
    "secret.example",
    "ROOM-99",
    "online_url",
    "onlineUrl",
    "Secret Trainer",
    TRAINER_ID,
    "trainer",
    "INTERNAL-NOTE",
    "notes",
    "capacity",
    "7919",
    "seatsTaken",
    "seatsAvailable",
    "few_seats_threshold",
    "venue_address",
    "1 Jalan Rahsia",
    "version",
    "deleted",
  ])
    assert.ok(!raw.includes(needle), `schedule body leaks "${needle}"`);
  // Online classes show no venue.
  const online = JSON.parse(raw).classes.find((c: { code: string }) =>
    c.code.startsWith("ONL"),
  );
  assert.equal(online.venueName, null);
  assert.equal(online.mode, "online");
});

it("schedule: price falls back to the course list price; language picks the course name; filters and limit", async () => {
  const { course, city } = await scheduleFixture();
  const sfx = crypto.randomUUID().slice(0, 6);
  await seedClass(course, city, { code: `EN-${sfx}`, price: null });
  await seedClass(course, city, {
    code: `ZH-${sfx}`,
    language: "zh",
    start: `${KL_TODAY} + 11`,
  });
  await seedClass(course, city, {
    code: `ZH2-${sfx}`,
    language: "zh",
    start: `${KL_TODAY} + 12`,
  });
  const q = (extra: string) =>
    schedule(`?city=${encodeURIComponent(city)}${extra}`);

  const all = (await (await q("")).json()).classes;
  assert.equal(all.length, 3);
  assert.equal(all[0].priceMyr, "4100.00");
  assert.equal(all[1].courseName, "人工智能自动化");
  assert.equal((await (await q("&language=zh")).json()).classes.length, 2);
  assert.equal((await (await q("&language=en")).json()).classes.length, 1);
  assert.equal((await (await q("&track=workshop")).json()).classes.length, 0);
  assert.equal(
    (await (await q("&track=certification")).json()).classes.length,
    3,
  );
  assert.equal((await (await q("&limit=2")).json()).classes.length, 2);
  assert.equal(
    (await (await schedule("?city=Nowhere-" + sfx)).json()).classes.length,
    0,
  );
});

it("schedule: bad filters are 400 and not cached; the default and maximum page sizes hold", async () => {
  for (const qs of [
    "?language=fr",
    "?track=magic",
    "?limit=0",
    "?limit=101",
    "?limit=abc",
    "?city=" + "x".repeat(101),
    "?city=",
  ]) {
    const res = await schedule(qs);
    assert.equal(res.status, 400, qs);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  const capped = await (await schedule("?limit=100")).json();
  assert.ok(capped.classes.length <= 100);
});
