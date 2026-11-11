// WATI webhook (lib/wati/webhook.ts): the shared-secret check, an inbound
// WhatsApp message becoming person + conversation + message, messages sent
// from the WATI app, delivery status events, and the retry queue. The
// payloads follow WATI's webhook reference (docs.wati.io, 6 Nov). Each DB
// test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  eventKey,
  processWatiEvent,
  recordWatiEvent,
  runWatiQueue,
  verifyWatiToken,
  type WatiEvent,
} from "../lib/wati/webhook.ts";
import { createEnquiry } from "../lib/enquiries/create.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson } from "./seed.ts";

after(closeDb);

test("the secret: exact match only, constant time, nothing set = refused", () => {
  assert.equal(
    verifyWatiToken("s3cret-value-of-length", "s3cret-value-of-length"),
    true,
  );
  assert.equal(
    verifyWatiToken("s3cret-value-of-length ", "s3cret-value-of-length"),
    false,
  );
  assert.equal(verifyWatiToken("other", "s3cret-value-of-length"), false);
  assert.equal(verifyWatiToken(null, "s3cret-value-of-length"), false);
  assert.equal(verifyWatiToken("", ""), false);
});

test("event key: type plus the WhatsApp message id; none = no key", () => {
  assert.equal(
    eventKey({ eventType: "message", whatsappMessageId: "wamid.A", id: "x" }),
    "message:wamid.A",
  );
  assert.equal(
    eventKey({ eventType: "message", id: "rec-1" }),
    "message:rec-1",
  );
  assert.equal(eventKey({ eventType: "message" }), null);
  assert.equal(eventKey({ id: "rec-1" }), null);
});

const rnd = () => crypto.randomUUID().slice(0, 8);
const phone = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;

const inbound = (waId: string, over: Partial<WatiEvent> = {}): WatiEvent => ({
  eventType: "message",
  id: `rec-${rnd()}`,
  whatsappMessageId: `wamid.${rnd()}`,
  conversationId: `conv-${rnd()}`,
  waId,
  senderName: "Lim Wei Jie",
  text: "Hi, is the Dec class still open?",
  type: "text",
  data: null,
  timestamp: "1767225600",
  ...over,
});

async function handle(e: WatiEvent) {
  const key = eventKey(e)!;
  await recordWatiEvent(key, e);
  return processWatiEvent(key);
}

const messagesOf = async (personId: string) =>
  db()`SELECT direction, body, status, external_message_id, sent_at
       FROM conversation_message WHERE person_id = ${personId} ORDER BY sent_at, created_at`;

it("an inbound message from a new number makes the person, the thread and the message", async () => {
  const wa = phone();
  const e = inbound(wa);
  const r = await handle(e);
  assert.equal(r.kind, "saved");

  const [p] = await db()`
    SELECT id, full_name, phone_e164, whatsapp_e164 FROM person WHERE phone_e164 = ${`+${wa}`}`;
  assert.equal(p.full_name, "Lim Wei Jie");
  assert.equal(p.whatsapp_e164, `+${wa}`);
  const [c] = await db()`
    SELECT id, channel, external_thread_id, last_inbound_at, last_message_at
    FROM conversation WHERE person_id = ${p.id}`;
  assert.equal(c.channel, "whatsapp");
  assert.equal(
    c.external_thread_id,
    wa,
    "one thread per customer: their WhatsApp id",
  );
  const msgs = await messagesOf(p.id);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].direction, "in");
  assert.equal(msgs[0].body, "Hi, is the Dec class still open?");
  assert.equal(msgs[0].status, "received");
  assert.equal(msgs[0].external_message_id, e.whatsappMessageId);
  assert.equal(
    msgs[0].sent_at.toISOString(),
    "2026-01-01T00:00:00.000Z",
    "WATI's unix time, not now",
  );
  assert.equal(c.last_inbound_at.toISOString(), "2026-01-01T00:00:00.000Z");

  // The stored event keeps no customer text once it is processed.
  const [ev] = await db()`
    SELECT status, payload FROM integration_event
    WHERE source = 'wati' AND external_event_id = ${eventKey(e)}`;
  assert.equal(ev.status, "processed");
  assert.equal(JSON.stringify(ev.payload).includes("Dec class"), false);
});

it("a redelivered event and a second message from a known number add nothing extra", async () => {
  const wa = phone();
  const known = await newPerson("Already In CRM");
  await db()`UPDATE person SET phone_e164 = ${`+${wa}`}, phone = ${wa} WHERE id = ${known}`;
  const first = inbound(wa, { senderName: "Someone Else" });
  await handle(first);
  assert.deepEqual(
    (await handle(first)).kind,
    "duplicate",
    "the same event twice does the work once",
  );
  await handle(inbound(wa, { text: "Second question" }));

  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM person WHERE phone_e164 = ${`+${wa}`}`
    )[0].n,
    1,
    "the hard phone match is the person: no second record, no rename",
  );
  const msgs = await messagesOf(known);
  assert.deepEqual(
    msgs.map((m) => m.body),
    ["Hi, is the Dec class still open?", "Second question"],
  );
  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM conversation WHERE person_id = ${known}`
    )[0].n,
    1,
  );
});

it("media without text gets a placeholder; a number that is not a phone fails for good", async () => {
  const wa = phone();
  await handle(
    inbound(wa, {
      type: "image",
      text: null,
      data: { mimeType: "image/jpeg" },
    }),
  );
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  assert.equal((await messagesOf(p.id))[0].body, "[image]");

  const bad = inbound("12", { text: "x" });
  const r = await handle(bad);
  assert.equal(r.kind, "failed");
  assert.equal(
    r.kind === "failed" && r.final,
    true,
    "retrying cannot fix a bad number",
  );
  const [ev] = await db()`
    SELECT payload FROM integration_event
    WHERE source = 'wati' AND external_event_id = ${eventKey(bad)}`;
  assert.equal(ev.payload.eventType, "message");
  assert.equal(ev.payload.waId, undefined, "given up: no phone number kept");
  assert.equal(ev.payload.text, undefined, "given up: no message text kept");
});

it("a status that arrives before its message waits, then moves the message on; one never matched is ignored", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const wamid = `wamid.${rnd()}`;
  const read: WatiEvent = {
    eventType: "sentMessageREAD_v2",
    id: "early",
    whatsappMessageId: wamid,
    waId: wa,
  };
  const due = (key: string, attempts: number) => db()`
    UPDATE integration_event
    SET next_attempt_at = now() - interval '1 minute', attempts = ${attempts}
    WHERE source = 'wati' AND external_event_id = ${key}`;
  const row = async (key: string) =>
    (
      await db()`SELECT status, payload FROM integration_event
                 WHERE source = 'wati' AND external_event_id = ${key}`
    )[0];

  assert.equal((await handle(read)).kind, "waiting");
  assert.equal((await row(eventKey(read)!)).status, "received");
  assert.deepEqual(
    await runWatiQueue(),
    { saved: 0, failed: 0, lost: 0 },
    "not due yet",
  );
  await handle({
    eventType: "sessionMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: wamid,
    waId: wa,
    text: "Yes, still open.",
  });
  await due(eventKey(read)!, 1);
  assert.equal((await runWatiQueue()).saved, 1);
  const [m] = await db()`
    SELECT status FROM conversation_message WHERE external_message_id = ${wamid}`;
  assert.equal(m.status, "read");

  // No message ever turns up: ignored on the last try, never a failure.
  const lost: WatiEvent = { ...read, id: "lost", whatsappMessageId: "wamid.x" };
  await handle(lost);
  await due(eventKey(lost)!, MAX_ATTEMPTS - 1);
  assert.deepEqual(await runWatiQueue(), { saved: 0, failed: 0, lost: 0 });
  const end = await row(eventKey(lost)!);
  assert.equal(end.status, "ignored");
  assert.equal(end.payload.waId, undefined);
});

it("a message typed in the WATI app is saved as ours; delivery and read events move it on, never back", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  const wamid = `wamid.${rnd()}`;
  const sent: WatiEvent = {
    eventType: "sessionMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: wamid,
    waId: wa,
    text: "Yes, 9-10 Dec still has seats.",
    timestamp: "1767225660",
  };
  await handle(sent);
  const status = async () =>
    (await messagesOf(p.id)).find((m) => m.direction === "out")!;
  assert.equal((await status()).body, "Yes, 9-10 Dec still has seats.");
  assert.equal((await status()).status, "sent");

  await handle({
    eventType: "sentMessageREAD_v2",
    id: "r1",
    whatsappMessageId: wamid,
    waId: wa,
  });
  assert.equal((await status()).status, "read");
  await handle({
    eventType: "sentMessageDELIVERED_v2",
    id: "r2",
    whatsappMessageId: wamid,
    waId: wa,
  });
  assert.equal(
    (await status()).status,
    "read",
    "a late delivered event doesn't undo read",
  );
  await handle({
    eventType: "sessionMessageFailed",
    id: "r3",
    whatsappMessageId: wamid,
    waId: wa,
    failedCode: "131026",
  });
  assert.equal(
    (await status()).status,
    "read",
    "failed doesn't undo a read message",
  );
});

it("a failed template send marks our message failed and keeps the reason", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  const wamid = `wamid.${rnd()}`;
  await handle({
    eventType: "templateMessageSent",
    id: `rec-${rnd()}`,
    whatsappMessageId: wamid,
    waId: wa,
    templateName: "onboarding_signoff",
    timestamp: "1767225700",
  });
  const out = (await messagesOf(p.id)).find((m) => m.direction === "out")!;
  assert.equal(out.body, "[template onboarding_signoff]");
  const f: WatiEvent = {
    eventType: "templateMessageFailed",
    id: "f1",
    whatsappMessageId: wamid,
    waId: wa,
    failedCode: "131026",
    failedDetail: "Message undeliverable",
  };
  await handle(f);
  assert.equal(
    (await messagesOf(p.id)).find((m) => m.direction === "out")!.status,
    "failed",
  );
  const [ev] = await db()`
    SELECT payload FROM integration_event WHERE source = 'wati' AND external_event_id = ${eventKey(f)}`;
  assert.equal(ev.payload.failedCode, "131026");
  assert.equal(ev.payload.failedDetail, "Message undeliverable");
});

it("events we don't use are ignored, not errors, and make no person", async () => {
  const wa = phone();
  const r2 = await handle({
    eventType: "newContactMessageReceived",
    id: `n-${rnd()}`,
    waId: wa,
  });
  assert.equal(r2.kind, "ignored");
  const r3 = await handle({
    eventType: "templateQualityUpdate",
    id: `q-${rnd()}`,
  });
  assert.equal(r3.kind, "ignored");
  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM person WHERE phone_e164 = ${`+${wa}`}`
    )[0].n,
    0,
  );
});

it("a stored event that failed is tried again by the queue, then given up after the last try", async () => {
  const wa = phone();
  const e = inbound(wa);
  const key = eventKey(e)!;
  await recordWatiEvent(key, e);
  // Make the first try fail: the thread's column refuses the value.
  await db()`UPDATE integration_event SET payload = jsonb_set(payload, '{waId}', '"12"')
             WHERE source = 'wati' AND external_event_id = ${key}`;
  const a = await processWatiEvent(key);
  assert.equal(a.kind, "failed");
  // Not due yet when the failure was not final → nothing to run now.
  await db()`UPDATE integration_event SET status = 'failed', attempts = 1,
               next_attempt_at = now() - interval '1 minute',
               payload = ${db().json(e as never)}
             WHERE source = 'wati' AND external_event_id = ${key}`;
  const r = await runWatiQueue();
  assert.equal(r.saved, 1);
  const [ev] =
    await db()`SELECT status FROM integration_event WHERE source = 'wati' AND external_event_id = ${key}`;
  assert.equal(ev.status, "processed");

  const dead = inbound("12");
  await recordWatiEvent(eventKey(dead)!, dead);
  await db()`UPDATE integration_event SET status = 'failed', attempts = ${MAX_ATTEMPTS}
             WHERE source = 'wati' AND external_event_id = ${eventKey(dead)}`;
  assert.deepEqual(
    await runWatiQueue(),
    { saved: 0, failed: 0, lost: 0 },
    "out of tries: left for people",
  );
});

it("WATI's echo of a reply typed in the inbox takes WATI's id instead of saving the reply twice", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [c] = await db()`
    SELECT id, person_id FROM conversation WHERE external_thread_id = ${wa}`;
  // What lib/wati/send.ts leaves once WATI has accepted an inbox reply.
  await db()`
    INSERT INTO conversation_message (conversation_id, person_id, channel, direction,
                               external_message_id, body, status)
    VALUES (${c.id}, ${c.person_id}, 'whatsapp', 'out', ${`app:${rnd()}`},
            'Yes, 9-10 Dec still has seats.', 'sent')`;
  const now = String(Math.floor(Date.now() / 1000));
  const echo: WatiEvent = {
    eventType: "sessionMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: `wamid.${rnd()}`,
    waId: wa,
    text: "Yes, 9-10 Dec still has seats.",
    type: "text",
    timestamp: now,
  };
  assert.equal((await handle(echo)).kind, "saved");
  const out = async () =>
    db()`SELECT external_message_id, status FROM conversation_message
         WHERE conversation_id = ${c.id} AND direction = 'out'`;
  assert.deepEqual(
    (await out()).map((m) => [m.external_message_id, m.status]),
    [[echo.whatsappMessageId, "sent"]],
    "one row, now under WATI's id",
  );
  await handle({
    eventType: "sentMessageDELIVERED_v2",
    id: echo.id,
    whatsappMessageId: echo.whatsappMessageId,
    waId: wa,
    timestamp: now,
  });
  assert.deepEqual(
    (await out()).map((m) => m.status),
    ["delivered"],
  );
});

it("a file with a caption is saved as [type] caption, the shape the history import uses", async () => {
  const wa = phone();
  await handle(inbound(wa, { type: "image", text: "my receipt" }));
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  assert.deepEqual(
    (await messagesOf(p.id)).map((m) => m.body),
    ["[image] my receipt"],
  );
});

it("a number with no WhatsApp profile name: the name is the number as sent, flagged no_name", async () => {
  const wa = phone();
  await handle(inbound(wa, { senderName: null }));
  const [p] = await db()`
    SELECT full_name, needs_review, needs_review_reason FROM person
    WHERE phone_e164 = ${`+${wa}`}`;
  assert.deepEqual(
    [p.full_name, p.needs_review, p.needs_review_reason],
    [wa, true, "no_name"],
  );
  const named = phone();
  await handle(inbound(named));
  const [q] = await db()`
    SELECT needs_review FROM person WHERE phone_e164 = ${`+${named}`}`;
  assert.equal(q.needs_review, false);
});

it("a reply typed in the WATI app stops the reply deadline of the thread's open enquiry; a template does not", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [c] = await db()`
    SELECT id, person_id FROM conversation
    WHERE channel = 'whatsapp' AND external_thread_id = ${wa}`;
  const made = await createEnquiry(
    {
      personId: c.person_id,
      conversationId: c.id,
      channel: "whatsapp",
      category: "other",
      subject: "Asked about seats",
    },
    null,
    new Set(),
  );
  assert.equal(made.kind, "ok");
  if (made.kind !== "ok") return;
  const firstResponse = async () =>
    (
      await db()`SELECT first_response_at FROM enquiry WHERE id = ${made.enquiry.id}`
    )[0].first_response_at;

  await handle({
    eventType: "templateMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: `wamid.${rnd()}`,
    waId: wa,
    templateName: "reminder",
    timestamp: "1767225660",
  });
  assert.equal(await firstResponse(), null, "a template is not a reply");

  await handle({
    eventType: "sessionMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: `wamid.${rnd()}`,
    waId: wa,
    text: "Yes, seats left.",
    timestamp: "1767225720",
  });
  assert.ok(await firstResponse(), "a typed reply is");
});

it("a customer writing again after their enquiry was closed gets a linked follow-up; an open one gets none", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [c] = await db()`
    SELECT id, person_id FROM conversation
    WHERE channel = 'whatsapp' AND external_thread_id = ${wa}`;
  const made = await createEnquiry(
    {
      personId: c.person_id,
      conversationId: c.id,
      channel: "whatsapp",
      category: "receipt",
      subject: "Receipt please",
    },
    null,
    new Set(),
  );
  assert.equal(made.kind, "ok");
  if (made.kind !== "ok") return;
  const count = async () =>
    (
      await db()`SELECT count(*)::int AS n FROM enquiry WHERE conversation_id = ${c.id}`
    )[0].n;

  // Still open: another message adds no enquiry.
  await handle(inbound(wa, { whatsappMessageId: `wamid.${rnd()}`, text: "?" }));
  assert.equal(await count(), 1);

  await db()`
    UPDATE enquiry SET status = 'human_resolved', closed_at = now(),
                       resolution = 'Sent'
    WHERE id = ${made.enquiry.id}`;
  await handle(
    inbound(wa, {
      whatsappMessageId: `wamid.${rnd()}`,
      text: "One more thing",
    }),
  );
  assert.equal(await count(), 2);
  const [next] = await db()`
    SELECT previous_enquiry_id, category, subject, status FROM enquiry
    WHERE conversation_id = ${c.id} AND id <> ${made.enquiry.id}`;
  assert.deepEqual(
    [next.previous_enquiry_id, next.category, next.subject, next.status],
    [made.enquiry.id, "receipt", "Re: Receipt please", "open"],
  );

  // A redelivered event is not a new message: no third enquiry.
  const last = inbound(wa, { whatsappMessageId: `wamid.${rnd()}` });
  await db()`UPDATE enquiry SET status = 'closed', closed_at = now(), resolution = 'x'
             WHERE conversation_id = ${c.id} AND status = 'open'`;
  await handle(last);
  await handle(last);
  assert.equal(await count(), 3);
});
