// The WhatsApp after-hours auto-reply (lib/wati/auto-reply.ts): once per
// thread per after-hours stretch, in the right language, never as staff's
// first response. WATI is a fake fetch. Each test is rolled back.
//
// Nov 2026: Fri 13, Sat 14, Sun 15, Mon 16. Office hours Mon–Fri 08:30–16:30
// Malaysia time. Run on a database with no holiday in those days.
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { AFTER_HOURS_TEXT } from "../lib/wati/auto-reply.ts";
import {
  eventKey,
  processWatiEvent,
  recordWatiEvent,
  type WatiEvent,
} from "../lib/wati/webhook.ts";
import { it } from "./seed.ts";

after(closeDb);

const myt = (s: string) => new Date(`${s}+08:00`);
const unix = (d: Date) => String(Math.floor(d.getTime() / 1000));
const rnd = () => crypto.randomUUID().slice(0, 8);
const phone = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;

function fake(status = 200) {
  const calls: { to: string; text: string }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    calls.push({ to: b.target, text: b.text });
    return new Response(JSON.stringify({ result: true }), { status });
  }) as unknown as typeof fetch;
  return {
    calls,
    wati: { host: "https://live-mt-server.wati.io", token: "t", fetchImpl },
  };
}

const message = (wa: string, at: Date, over: Partial<WatiEvent> = {}) => ({
  eventType: "message",
  id: `rec-${rnd()}`,
  whatsappMessageId: `wamid.${rnd()}`,
  waId: wa,
  senderName: "Lim Wei Jie",
  text: "Hi, is the Dec class still open?",
  type: "text",
  timestamp: unix(at),
  ...over,
});

async function handle(
  e: WatiEvent,
  opts: Parameters<typeof processWatiEvent>[1],
) {
  const key = eventKey(e)!;
  await recordWatiEvent(key, e);
  return processWatiEvent(key, opts);
}

const outOf = (wa: string) =>
  db()`
    SELECT m.body, m.status, m.automated FROM conversation_message m
    JOIN conversation c ON c.id = m.conversation_id
    WHERE c.external_thread_id = ${wa} AND m.direction = 'out'
    ORDER BY m.created_at`;

async function noHolidays() {
  await db()`DELETE FROM holiday WHERE day BETWEEN '2026-11-12' AND '2026-11-18'`;
}

it("after hours: one reply per evening, none in office hours, again the next evening", async () => {
  await noHolidays();
  const wa = phone();
  const f = fake();
  const friEvening = myt("2026-11-13T18:00:00");
  await handle(message(wa, friEvening), { wati: f.wati, now: friEvening });
  await handle(message(wa, myt("2026-11-13T21:00:00")), {
    wati: f.wati,
    now: myt("2026-11-13T21:00:30"),
  });
  // Saturday is the same stretch: it runs until Monday 08:30.
  await handle(message(wa, myt("2026-11-14T10:00:00")), {
    wati: f.wati,
    now: myt("2026-11-14T10:00:30"),
  });
  assert.equal(f.calls.length, 1, "Friday evening to Monday morning: once");
  assert.equal(f.calls[0].to, wa);
  assert.equal(f.calls[0].text, AFTER_HOURS_TEXT.en);
  const [m] = await outOf(wa);
  assert.deepEqual([m.status, m.automated], ["sent", true]);

  await handle(message(wa, myt("2026-11-16T09:00:00")), {
    wati: f.wati,
    now: myt("2026-11-16T09:00:30"),
  });
  assert.equal(f.calls.length, 1, "office hours: none");
  await handle(message(wa, myt("2026-11-16T19:00:00")), {
    wati: f.wati,
    now: myt("2026-11-16T19:00:30"),
  });
  assert.equal(f.calls.length, 2, "Monday evening is a new stretch");
});

it("in the class language, else the person's", async () => {
  await noHolidays();
  const wa = phone();
  const f = fake();
  const at = myt("2026-11-13T20:00:00");
  await handle(message(wa, at), { wati: f.wati, now: at });
  // A second thread whose person prefers Chinese.
  const wa2 = phone();
  await handle(message(wa2, myt("2026-11-12T20:00:00")), {
    wati: undefined,
  });
  await db()`UPDATE person SET preferred_language = 'zh' WHERE phone_e164 = ${`+${wa2}`}`;
  await handle(message(wa2, at), { wati: f.wati, now: at });
  assert.equal(f.calls[0].text, AFTER_HOURS_TEXT.en);
  assert.equal(f.calls[1].text, AFTER_HOURS_TEXT.zh);
});

it("a message read late (a retried event) or in office hours now gets no reply; no WATI, no reply", async () => {
  await noHolidays();
  const f = fake();
  const at = myt("2026-11-13T18:00:00");
  await handle(message(phone(), at), {
    wati: f.wati,
    now: myt("2026-11-13T20:30:00"),
  });
  await handle(message(phone(), at), {
    wati: f.wati,
    now: myt("2026-11-16T09:00:00"),
  });
  await handle(message(phone(), at), { wati: undefined, now: at });
  assert.equal(f.calls.length, 0);
});

it("WATI failing marks the reply failed; the customer's message is still processed", async () => {
  await noHolidays();
  const wa = phone();
  const at = myt("2026-11-13T18:00:00");
  const r = await handle(message(wa, at), { wati: fake(500).wati, now: at });
  assert.equal(r.kind, "saved");
  const [m] = await outOf(wa);
  assert.deepEqual([m.status, m.automated], ["failed", true]);
});

it("WATI's echo of the auto-reply is matched to it and is not staff's first response", async () => {
  await noHolidays();
  const wa = phone();
  const at = myt("2026-11-13T18:00:00");
  await handle(message(wa, at), { wati: fake().wati, now: at });
  const [e] = await db()`
    SELECT e.id FROM enquiry e JOIN conversation c ON c.id = e.conversation_id
    WHERE c.external_thread_id = ${wa}`;
  assert.ok(e, "the message opened an enquiry");
  // The echo arrives at about the time the reply was saved.
  const [sent] = await db()`
    SELECT m.created_at FROM conversation_message m
    JOIN conversation c ON c.id = m.conversation_id
    WHERE c.external_thread_id = ${wa} AND m.automated`;
  await handle(
    {
      eventType: "sessionMessageSent_v2",
      id: `rec-${rnd()}`,
      whatsappMessageId: `wamid.${rnd()}`,
      waId: wa,
      text: AFTER_HOURS_TEXT.en,
      timestamp: unix(sent.created_at as Date),
    },
    { wati: undefined },
  );
  const out = await outOf(wa);
  assert.equal(out.length, 1, "not saved twice");
  const [row] =
    await db()`SELECT first_response_at FROM enquiry WHERE id = ${e.id}`;
  assert.equal(row.first_response_at, null, "the deadline keeps running");
});
