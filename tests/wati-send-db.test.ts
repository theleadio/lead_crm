// Replying through WATI from the inbox (lib/wati/send.ts, moved from
// lead_sales' PR #21). WATI is a fake fetch that records what it was asked;
// each DB test is rolled back. The automation template sender stays in
// lead_sales with its tests.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { createEnquiry } from "../lib/enquiries/create.ts";
import {
  recentTemplateNames,
  sendInboxReply,
  sendInboxTemplate,
} from "../lib/wati/send.ts";
import { parseParams } from "../app/(app)/(crm)/inbox/template-params.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

type Call = { url: string; body: Record<string, unknown>; auth: string };
function fake(
  status = 200,
  json: unknown = { result: true },
  // Runs while WATI is "answering": what else can happen meanwhile.
  meanwhile?: () => Promise<unknown>,
) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: (init.headers as Record<string, string>).Authorization,
    });
    await meanwhile?.();
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return {
    calls,
    o: {
      host: "https://live-mt-server.wati.io/12345",
      token: "tok",
      fetchImpl,
    },
  };
}

const wa = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;

async function chat(inboundAgo: string | null) {
  const number = wa();
  const p = await newPerson("Chat person");
  await db()`UPDATE person SET phone_e164 = ${`+${number}`}, whatsapp_e164 = ${`+${number}`}, phone = ${number} WHERE id = ${p}`;
  const [c] = await db()`
    INSERT INTO conversation (person_id, channel, external_thread_id, last_inbound_at)
    VALUES (${p}, 'whatsapp', ${number},
            ${inboundAgo === null ? null : db()`now() - ${inboundAgo}::interval`})
    RETURNING id`;
  return { p, number, conv: c.id as string };
}

it("a reply inside the window is sent to the number and saved as ours, sent", async () => {
  const u = await newUser("management");
  const { conv, number } = await chat("1 hour");
  const { calls, o } = fake();
  assert.deepEqual(await sendInboxReply(o, u, conv, "  Yes, seats left.  "), {
    kind: "sent",
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://live-mt-server.wati.io/api/ext/v3/conversations/messages/text",
  );
  assert.deepEqual(calls[0].body, { target: number, text: "Yes, seats left." });
  assert.equal(calls[0].auth, "Bearer tok");
  const [m] = await db()`
    SELECT direction, body, status, sent_by_user_id FROM conversation_message
    WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    [m.direction, m.body, m.status, m.sent_by_user_id],
    ["out", "Yes, seats left.", "sent", u.id],
  );
});

it("a closed window sends nothing", async () => {
  const u = await newUser("management");
  const { conv } = await chat("30 hours");
  const { calls, o } = fake();
  const r = await sendInboxReply(o, u, conv, "hi");
  assert.equal(r.kind, "invalid");
  if (r.kind === "invalid") assert.match(r.message, /window/);
  assert.equal(calls.length, 0);
});

it("WATI refusing the message marks it failed and tells the user", async () => {
  const u = await newUser("management");
  const { conv } = await chat("1 hour");
  for (const f of [fake(500), fake(200, { result: false })]) {
    assert.equal(
      (await sendInboxReply(f.o, u, conv, "hi")).kind,
      "send_failed",
    );
  }
  const rows =
    await db()`SELECT status FROM conversation_message WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    rows.map((r) => r.status),
    ["failed", "failed"],
  );
});

it("a reply the webhook matched to WATI's echo before the send returned keeps WATI's id and a later status", async () => {
  const u = await newUser("management");
  const { conv } = await chat("1 hour");
  // What lib/wati/webhook.ts does with WATI's echo and a quick "delivered".
  const { o } = fake(
    200,
    { result: true },
    () =>
      db()`
      UPDATE conversation_message SET external_message_id = 'wamid.echo', status = 'delivered'
      WHERE conversation_id = ${conv} AND external_message_id LIKE 'app:%'`,
  );
  await sendInboxReply(o, u, conv, "Yes, seats left.");
  const rows = await db()`
    SELECT external_message_id, status FROM conversation_message
    WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    rows.map((r) => [r.external_message_id, r.status]),
    [["wamid.echo", "delivered"]],
  );
});

it("the first reply stops the reply deadline of the conversation's open enquiry", async () => {
  const u = await newUser("management");
  const { conv, p } = await chat("1 hour");
  const made = await createEnquiry(
    {
      personId: p,
      conversationId: conv,
      channel: "whatsapp",
      category: "other",
      subject: "Seats?",
    },
    u,
    new Set(),
  );
  assert.equal(made.kind, "ok");
  if (made.kind !== "ok") return;
  await sendInboxReply(fake().o, u, conv, "Yes, seats left.");
  const [e] = await db()`
    SELECT first_response_at FROM enquiry WHERE id = ${made.enquiry.id}`;
  assert.ok(e.first_response_at, "first response stamped");
  const events = await db()`
    SELECT kind FROM enquiry_event WHERE enquiry_id = ${made.enquiry.id}`;
  assert.ok(events.some((ev) => ev.kind === "first_response"));
});

it("someone who may not see the conversation gets not_found, and WATI is not called", async () => {
  const outsider = await newUser("operations");
  const { conv } = await chat("1 hour");
  const { calls, o } = fake();
  assert.equal(
    (await sendInboxReply(o, outsider, conv, "hi")).kind,
    "not_found",
  );
  assert.equal(calls.length, 0);
});

// ---- Templates from the inbox ------------------------------------------------

it("a template goes out with our id as local_message_id, is saved as ours, and stops the deadline", async () => {
  const u = await newUser("management");
  const { conv, number, p } = await chat("30 hours");
  const made = await createEnquiry(
    {
      personId: p,
      conversationId: conv,
      channel: "whatsapp",
      category: "other",
      subject: "Seats?",
    },
    u,
    new Set(),
  );
  assert.equal(made.kind, "ok");
  const { calls, o } = fake();
  const r = await sendInboxTemplate(o, u, conv, " follow_up_en ", [
    { name: "name", value: "Mei Ling" },
  ]);
  assert.deepEqual(r, { kind: "sent" });
  assert.equal(
    calls[0].url,
    "https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send",
  );
  const body = calls[0].body as {
    template_name: string;
    recipients: {
      target: string;
      local_message_id: string;
      custom_params: unknown;
    }[];
  };
  assert.equal(body.template_name, "follow_up_en");
  assert.equal(body.recipients[0].target, number);
  assert.deepEqual(body.recipients[0].custom_params, [
    { name: "name", value: "Mei Ling" },
  ]);
  const [m] = await db()`
    SELECT body, status, sent_by_user_id, external_message_id FROM conversation_message
    WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    [m.body, m.status, m.sent_by_user_id, m.external_message_id],
    [
      "[template follow_up_en]",
      "sent",
      u.id,
      body.recipients[0].local_message_id,
    ],
  );
  if (made.kind === "ok") {
    const [e] = await db()`
      SELECT first_response_at FROM enquiry WHERE id = ${made.enquiry.id}`;
    assert.ok(e.first_response_at, "a template from staff is a reply");
  }
  assert.deepEqual(await recentTemplateNames(), [
    "follow_up_en",
    ...(await recentTemplateNames()).filter((n) => n !== "follow_up_en"),
  ]);
});

it("a refused template is failed; no clear answer leaves it queued and says so; a bad name sends nothing", async () => {
  const u = await newUser("management");
  const { conv } = await chat(null);
  assert.equal(
    (await sendInboxTemplate(fake(400).o, u, conv, "nope", [])).kind,
    "send_failed",
  );
  assert.equal(
    (await sendInboxTemplate(fake(503).o, u, conv, "maybe", [])).kind,
    "unknown",
  );
  const rows = await db()`
    SELECT body, status FROM conversation_message
    WHERE conversation_id = ${conv} ORDER BY created_at`;
  assert.deepEqual(
    rows.map((r) => [r.body, r.status]),
    [
      ["[template nope]", "failed"],
      ["[template maybe]", "queued"],
    ],
  );
  const f = fake();
  const bad = await sendInboxTemplate(f.o, u, conv, "Not A Name!", []);
  assert.equal(bad.kind, "invalid");
  assert.equal(f.calls.length, 0);
});

test("template parameters: one name=value per line", () => {
  assert.deepEqual(parseParams("name=Mei Ling\n\n course = AIM \nflag"), [
    { name: "name", value: "Mei Ling" },
    { name: "course", value: "AIM" },
    { name: "flag", value: "" },
  ]);
});

it("WATI busy (429, 408) is not a wrong name: the row is failed and the user is told to send again", async () => {
  const u = await newUser("management");
  const { conv } = await chat("1 hour");
  assert.equal(
    (await sendInboxTemplate(fake(429).o, u, conv, "follow_up_en", [])).kind,
    "busy",
  );
  assert.equal(
    (await sendInboxReply(fake(408).o, u, conv, "Hello")).kind,
    "busy",
  );
  assert.equal(
    (await sendInboxTemplate(fake(400).o, u, conv, "follow_up_en", [])).kind,
    "send_failed",
  );
  const rows = await db()`
    SELECT status FROM conversation_message
    WHERE conversation_id = ${conv} ORDER BY created_at`;
  assert.deepEqual(
    rows.map((r) => r.status),
    ["failed", "failed", "failed"],
  );
});
