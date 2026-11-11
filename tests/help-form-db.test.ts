// The public help form (lib/public/help.ts, moved from lead_sales with
// migration 019): a submission becomes a person, a web_form conversation and
// message, and an enquiry for the chosen category's team; repeats and floods
// are stopped. Each test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LIMIT_PER_HOUR,
  helpCaptcha,
  helpFormSchema,
  submitHelpForm,
} from "../lib/public/help.ts";
import {
  allowedOrigins,
  originAllowed,
  requestIp,
} from "../lib/public/guard.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const env = { RATE_LIMIT_SECRET: "s".repeat(32) };
const ctx = (ip: string | null = "203.0.113.7") => ({
  ip,
  env,
  captcha: null,
});
const form = (over: Record<string, unknown> = {}) =>
  helpFormSchema.parse({
    fullName: "Tan Mei Ling",
    email: `help-${crypto.randomUUID().slice(0, 8)}@example.test`,
    category: "receipt",
    message: "I need the receipt for my March class.\nPaid by FPX.",
    ...over,
  });
// Each test uses its own IP so the per-IP limit of another test can't apply.
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

test("the form needs a name, an email or phone, a topic and a message", () => {
  assert.equal(
    helpFormSchema.safeParse({
      fullName: "A",
      category: "receipt",
      message: "hello there",
    }).success,
    false,
  );
  assert.equal(
    helpFormSchema.safeParse({
      fullName: "A",
      phone: "0123456789",
      category: "receipt",
      message: "hi",
    }).success,
    false,
    "message too short",
  );
  assert.equal(
    helpFormSchema.safeParse({
      fullName: "A",
      phone: "0123456789",
      category: "Receipt!",
      message: "hello there",
    }).success,
    false,
  );
});

test("origins: listed https origins only; no Origin is a same-site post", () => {
  const e = {
    PUBLIC_ALLOWED_ORIGINS: "https://thelead.io, http://evil.test, *",
  };
  assert.deepEqual(allowedOrigins(e), ["https://thelead.io"]);
  assert.equal(originAllowed(e, "https://thelead.io"), true);
  assert.equal(originAllowed(e, "https://evil.test"), false);
  assert.equal(originAllowed(e, null), true);
  const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  assert.equal(requestIp(h), "203.0.113.9");
  assert.equal(requestIp(new Headers({ "x-real-ip": "junk" })), null);
});

test("captcha: off until a key is set; then a token is required", async () => {
  assert.equal(helpCaptcha({}), null);
  const ok = helpCaptcha({ TURNSTILE_SECRET_KEY: "k" }, (async () =>
    Response.json({ success: true })) as typeof fetch)!;
  assert.equal(await ok("token", null), true);
  assert.equal(await ok(null, null), false);
  const down = helpCaptcha({ TURNSTILE_SECRET_KEY: "k" }, (async () => {
    throw new Error("down");
  }) as typeof fetch)!;
  assert.equal(await down("token", null), false);
});

it("a submission becomes a person, a web_form message and a Finance enquiry", async () => {
  await db()`DELETE FROM team_member`;
  await db()`DELETE FROM enquiry_rule`;
  const fin = await newUser("operations");
  await db()`
    INSERT INTO team_member (team_id, user_id)
    SELECT id, ${fin.id} FROM team WHERE code = 'finance'`;
  const input = form();
  const r = await submitHelpForm(input, ctx(ip()));
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.match(r.reference, /^E-\d{6}$/);

  const [t] = await db()`
    SELECT t.channel, t.category, t.subject, t.assigned_user_id,
           t.conversation_id, t.sla_due_at, tm.code AS team, p.email,
           p.full_name
    FROM enquiry t JOIN team tm ON tm.id = t.team_id
    JOIN person p ON p.id = t.person_id
    WHERE t.number = ${r.reference}`;
  assert.equal(t.channel, "web_form");
  assert.ok(t.sla_due_at, "a reply deadline is set");
  assert.equal(t.category, "receipt");
  assert.equal(t.team, "finance");
  assert.equal(t.assigned_user_id, fin.id);
  assert.equal(t.subject, "I need the receipt for my March class.");
  assert.equal(t.email, input.email);
  const [m] = await db()`
    SELECT direction, channel, body FROM conversation_message WHERE conversation_id = ${t.conversation_id}`;
  assert.equal(m.direction, "in");
  assert.equal(m.channel, "web_form");
  assert.match(m.body, /Paid by FPX/);
});

it("an existing person (same email, any case) is reused, not duplicated", async () => {
  const email = `known-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [p] = await db()`
    INSERT INTO person (full_name, email) VALUES ('Known Customer', ${email}) RETURNING id`;
  const r = await submitHelpForm(
    form({ email: email.toUpperCase() }),
    ctx(ip()),
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  const [t] =
    await db()`SELECT person_id FROM enquiry WHERE number = ${r.reference}`;
  assert.equal(t.person_id, p.id);
});

it("the same idempotency key twice gives the same enquiry, once", async () => {
  const input = form({ idempotencyKey: `help:${crypto.randomUUID()}` });
  const a = await submitHelpForm(input, ctx(ip()));
  const b = await submitHelpForm(input, ctx(ip()));
  assert.equal(a.kind, "created");
  assert.equal(b.kind, "created");
  if (a.kind !== "created" || b.kind !== "created") return;
  assert.equal(b.reference, a.reference);
  assert.equal(b.replayed, true);
});

it("limits: 3 an hour per email, 10 a minute per IP", async () => {
  const email = `flood-${crypto.randomUUID().slice(0, 8)}@example.test`;
  for (let i = 0; i < CONTACT_LIMIT_PER_HOUR; i++)
    assert.equal(
      (await submitHelpForm(form({ email }), ctx(ip()))).kind,
      "created",
    );
  assert.equal(
    (await submitHelpForm(form({ email }), ctx(ip()))).kind,
    "rate_limited",
  );

  const one = ip();
  const kinds: string[] = [];
  for (let i = 0; i < 11; i++)
    kinds.push((await submitHelpForm(form(), ctx(one))).kind);
  assert.deepEqual(kinds.slice(0, 10), Array(10).fill("created"));
  assert.equal(kinds[10], "rate_limited");
});

it("an unknown or switched-off category is refused; a failed captcha too; no secret = closed", async () => {
  assert.equal(
    (await submitHelpForm(form({ category: "no_such_topic" }), ctx(ip()))).kind,
    "unknown_category",
  );
  assert.equal(
    (
      await submitHelpForm(form(), {
        ip: ip(),
        env,
        captcha: async () => false,
      })
    ).kind,
    "captcha_failed",
  );
  await assert.rejects(
    submitHelpForm(form(), { ip: ip(), env: {}, captcha: null }),
    /RATE_LIMIT_SECRET/,
  );
});
