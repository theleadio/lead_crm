import { createHash, timingSafeEqual } from "node:crypto";
import { writeAudit } from "../audit.ts";
import { referralOf, saveCtwaTouch } from "../import/wati-ctwa.ts";
import { findDuplicate } from "../people/dedupe.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { markFirstResponse } from "../enquiries/service.ts";
import { raiseDuplicateTask } from "../people/duplicate-review.ts";
import { dedupeCandidates } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";

// WATI webhook, inbound side (cutover plan WP1). Moved from lead_sales (its
// PR #19) with the inbox, migration 019. Event and field
// names follow WATI's webhook reference (docs.wati.io, read 6 Nov); verify
// them against a real delivery before relying on one. What it does:
//   message                     customer message → person, thread, message
//   sessionMessageSent(_v2),
//   templateMessageSent(_v2)    a message sent from the WATI app → ours (out)
//   sentMessageDELIVERED(_v2),
//   sentMessageREAD(_v2),
//   sessionMessageFailed,
//   templateMessageFailed       moves our message's status on, never back
// Everything else is recorded and ignored. Sending is lib/wati/send.ts.
//
// A free-text reply staff send from the WATI app (sessionMessageSent) counts
// as the first response on the conversation's open enquiries, so their reply
// deadline stops (lib/enquiries/service.ts markFirstResponse). A template
// does not: automations send those.
//
// WATI documents no signature, so the URL carries a long random secret
// (WATI_WEBHOOK_SECRET, ?token=…). The webhook records each event in
// integration_event first (source 'wati'), then processes it; one that
// fails is tried again by `npm run wati:run`, like Meta leads. Once an event
// is done its stored payload shrinks to ids: the customer's text lives in
// conversation_message only, which erase_person() clears (PDPA).

export const SOURCE = "wati";
export const MAX_ATTEMPTS = 5;
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
const LEASE_SECONDS = 300;

export type WatiEvent = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number"
      ? String(v)
      : null;

// ---- The secret ------------------------------------------------------------------

export function verifyWatiToken(given: string | null, secret: string): boolean {
  if (!secret || !given) return false;
  // Hashed first: timingSafeEqual needs equal lengths, and the length of the
  // secret shouldn't leak.
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(secret));
}

// ---- Events ----------------------------------------------------------------------

const INBOUND = new Set(["message"]);
const ECHO = new Set([
  "sessionMessageSent",
  "sessionMessageSent_v2",
  "templateMessageSent",
  "templateMessageSent_v2",
]);
const STATUS: Record<string, "delivered" | "read" | "failed"> = {
  sentMessageDELIVERED: "delivered",
  sentMessageDELIVERED_v2: "delivered",
  sentMessageREAD: "read",
  sentMessageREAD_v2: "read",
  sessionMessageFailed: "failed",
  templateMessageFailed: "failed",
};
// A status only moves forward: queued < sent < failed < delivered < read.
const RANK = { queued: 0, sent: 1, failed: 1.5, delivered: 2, read: 3 };

// One key per event type and message: WATI sends several events for one
// message (sent, delivered, read), and a redelivery has the same key.
export function eventKey(e: WatiEvent): string | null {
  const type = str(e.eventType);
  const id = str(e.whatsappMessageId) ?? str(e.id);
  return type && id ? `${type}:${id}` : null;
}

// What stays in integration_event once an event is done.
function kept(e: WatiEvent): Record<string, unknown> {
  return {
    eventType: str(e.eventType),
    id: str(e.id),
    whatsappMessageId: str(e.whatsappMessageId),
    failedCode: str(e.failedCode),
    failedDetail: str(e.failedDetail),
    // The ad, for tracing an opt-in back to its event (an id, not text).
    adId: referralOf(e)?.adId ?? null,
  };
}

export async function recordWatiEvent(
  key: string,
  e: WatiEvent,
): Promise<boolean> {
  const sql = db();
  const [row] = await sql`
    INSERT INTO integration_event (source, external_event_id, payload)
    VALUES (${SOURCE}, ${key}, ${sql.json(e as never)})
    ON CONFLICT (source, external_event_id) DO NOTHING
    RETURNING id`;
  return Boolean(row);
}

// ---- Saving ----------------------------------------------------------------------

// A payload retrying can't fix (no usable phone number).
class NotUsable extends Error {}

// A status for a message this app has not saved (yet). Tried again on the
// usual schedule, in case the message's own event is still on its way; after
// the last try it is ignored, not failed: most are messages sent before this
// app was connected.
class NotYet extends Error {}
const NOT_KNOWN = "not a message this app knows";

function whenOf(e: WatiEvent): Date {
  const t = str(e.timestamp);
  if (t && /^\d+$/.test(t))
    return new Date(Number(t) * (t.length > 10 ? 1 : 1000));
  const c = str(e.created);
  const d = c ? new Date(c) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
}

// §12.2, as the help form does: a hard match on the phone is
// the person (never renamed); a soft match still creates, flagged, with a
// review task.
//
// No WhatsApp profile name: §11.2 (O24). The name is the
// number as WATI sent it, flagged `no_name` so staff add a real one; a real
// name typed in the CRM clears the flag. The CHECK allows one reason, so a
// soft match keeps its own: it also raises a review task.
async function findOrCreatePerson(
  e164: string,
  name: string | null,
  numberAsSent: string,
): Promise<string> {
  const candidate = {
    fullName: name ?? numberAsSent,
    emailNorm: null,
    phoneE164: e164,
    companyNorm: null,
  };
  const dup = findDuplicate(candidate, await dedupeCandidates(candidate, null));
  if (dup.kind === "hard") return dup.match.id;
  const reason =
    dup.kind === "soft"
      ? `possible_duplicate_${dup.on}`
      : name === null
        ? "no_name"
        : null;
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164, whatsapp_e164,
                        needs_review, needs_review_reason)
    VALUES (${candidate.fullName}, ${e164}, ${e164}, ${e164},
            ${reason !== null}, ${reason})
    RETURNING id`;
  if (dup.kind === "soft")
    await raiseDuplicateTask(
      p.id,
      { id: dup.match.id, fullName: dup.match.fullName },
      null,
    );
  await writeAudit({
    userId: null,
    action: "create",
    entity: "person",
    entityId: p.id,
    before: null,
    after: { source: "wati" },
  });
  return p.id as string;
}

function e164Of(e: WatiEvent): string {
  const wa = (str(e.waId) ?? "").replace(/\D/g, "");
  const e164 = wa ? normalizePhoneE164(`+${wa}`) : null;
  if (!e164) throw new NotUsable("The event has no usable phone number");
  return e164;
}

// The same shape the WhatsApp history import gives a message
// (lib/wati/history.ts): text as it is; a file as `[type]`, then its caption.
// A message both of them bring in is then the same text, and the import
// recognises it instead of saving it twice.
function bodyOf(e: WatiEvent): string {
  const text = str(e.text);
  const type = str(e.type);
  const template = str(e.templateName) ?? str(e.elementName);
  if (type && type !== "text" && !template)
    return text ? `[${type}] ${text}` : `[${type}]`;
  if (text) return text;
  if (template) return `[template ${template}]`;
  return `[${type ?? "message"}]`;
}

// One WhatsApp thread per customer: their WhatsApp number is the thread id.
async function saveMessage(
  e: WatiEvent,
  direction: "in" | "out",
): Promise<string> {
  const sql = db();
  const e164 = e164Of(e);
  // Messages a second apart from a new number run in two transactions: the
  // second waits here, then finds the person the first one made, and does
  // not fail on the unique phone number.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`wati:${e164}`}))`;
  const personId = await findOrCreatePerson(
    e164,
    str(e.senderName),
    str(e.waId) ?? e164,
  );
  const at = whenOf(e);
  const inboundAt = direction === "in" ? at : null;
  const [conv] = await sql`
    INSERT INTO conversation (person_id, channel, external_thread_id,
                                    last_message_at, last_inbound_at)
    VALUES (${personId}, 'whatsapp', ${e164.slice(1)}, ${at}, ${inboundAt})
    ON CONFLICT (channel, external_thread_id) DO UPDATE
      SET last_message_at = greatest(conversation.last_message_at, ${at}),
          last_inbound_at = greatest(conversation.last_inbound_at, ${inboundAt})
    RETURNING id`;
  await sql`
    INSERT INTO conversation_message (conversation_id, person_id, channel, direction,
                               external_message_id, body, sent_at, status)
    VALUES (${conv.id}, ${personId}, 'whatsapp', ${direction},
            ${str(e.whatsappMessageId) ?? str(e.id)}, ${bodyOf(e)}, ${at},
            ${direction === "in" ? "received" : "sent"})
    ON CONFLICT (channel, external_message_id) DO NOTHING`;
  return conv.id as string;
}

// Staff answered on this thread: the first reply on each open enquiry of
// the conversation stops its deadline. Later replies change nothing.
export async function markReplied(conversationId: string) {
  const open = await db()`
    SELECT id FROM enquiry
    WHERE conversation_id = ${conversationId}
      AND status IN ('open','waiting_customer') AND first_response_at IS NULL`;
  for (const e of open) await markFirstResponse(e.id as string, null);
}

const isSession = (type: string) => type.startsWith("sessionMessageSent");

async function threadOf(e: WatiEvent): Promise<string | null> {
  const [c] = await db()`
    SELECT id FROM conversation
    WHERE channel = 'whatsapp' AND external_thread_id = ${e164Of(e).slice(1)}`;
  return (c?.id as string | undefined) ?? null;
}

// Our message, by any id WATI might use for it.
const idsOf = (e: WatiEvent) =>
  [str(e.whatsappMessageId), str(e.localMessageId), str(e.id)].filter(
    (x): x is string => x !== null,
  );

async function moveStatus(
  ids: string[],
  to: keyof typeof RANK,
): Promise<boolean> {
  const sql = db();
  const found = await sql`
    SELECT id FROM conversation_message
    WHERE channel = 'whatsapp' AND direction = 'out'
      AND external_message_id = ANY(${ids})`;
  if (found.length === 0) return false;
  await sql`
    UPDATE conversation_message SET status = ${to}
    WHERE channel = 'whatsapp' AND direction = 'out'
      AND external_message_id = ANY(${ids})
      AND (CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1
                       WHEN 'failed' THEN 1.5 WHEN 'delivered' THEN 2
                       WHEN 'read' THEN 3 ELSE 0 END) < ${RANK[to]}`;
  return true;
}

// A reply typed in this app's inbox (lib/wati/send.ts) is saved before WATI
// has an id for it, under one of ours: "app:<uuid>". WATI's echo of it
// carries WATI's ids only, so it is matched by thread, text and time, and the
// row takes WATI's id. Delivery and read events then find it, and the echo
// does not save the reply a second time. Oldest first, so two identical
// replies are matched one each. An echo sent means WATI sent it, so a row
// marked queued or failed (WATI's answer was lost) becomes sent.
const OUR_ID_PREFIX = "app:";
const ADOPT_WINDOW = "10 minutes";

async function adoptOurReply(e: WatiEvent): Promise<boolean> {
  const ext = str(e.whatsappMessageId) ?? str(e.id);
  if (!ext) return false;
  const thread = e164Of(e).slice(1);
  const at = whenOf(e);
  const [row] = await db()`
    UPDATE conversation_message
    SET external_message_id = ${ext},
        status = CASE WHEN status IN ('queued','failed') THEN 'sent' ELSE status END
    WHERE id = (
      SELECT m.id FROM conversation_message m
      JOIN conversation c ON c.id = m.conversation_id
      WHERE c.channel = 'whatsapp' AND c.external_thread_id = ${thread}
        AND m.channel = 'whatsapp' AND m.direction = 'out'
        AND m.external_message_id LIKE ${`${OUR_ID_PREFIX}%`}
        AND m.body = ${bodyOf(e)}
        AND m.created_at BETWEEN ${at}::timestamptz - ${ADOPT_WINDOW}::interval
                             AND ${at}::timestamptz + ${ADOPT_WINDOW}::interval
      ORDER BY m.created_at, m.id
      LIMIT 1
      FOR UPDATE OF m)
    RETURNING id`;
  return Boolean(row);
}

type Done = { kind: "saved" } | { kind: "ignored"; reason: string };

async function dispatch(e: WatiEvent): Promise<Done> {
  const type = str(e.eventType) ?? "";
  if (INBOUND.has(type)) {
    await saveMessage(e, "in");
    // From a click-to-WhatsApp ad: the opt-in touchpoint, live. The nightly
    // sync (scripts/sync-wati-ctwa.ts) records the same click once only.
    const ref = referralOf(e);
    if (ref)
      await saveCtwaTouch(str(e.waId) ?? "", str(e.senderName), ref, whenOf(e));
    return { kind: "saved" };
  }
  if (ECHO.has(type)) {
    if (!(await moveStatus(idsOf(e), "sent")) && !(await adoptOurReply(e))) {
      const conv = await saveMessage(e, "out");
      if (isSession(type)) await markReplied(conv);
    } else if (isSession(type)) {
      const conv = await threadOf(e);
      if (conv) await markReplied(conv);
    }
    return { kind: "saved" };
  }
  const to = STATUS[type];
  if (to) {
    // WATI does not promise order: "delivered" can arrive before "sent".
    if (!(await moveStatus(idsOf(e), to))) throw new NotYet();
    return { kind: "saved" };
  }
  return { kind: "ignored", reason: `event ${type || "(none)"} is not used` };
}

// ---- Queue -----------------------------------------------------------------------

export type ProcessResult =
  | Done
  | { kind: "duplicate" }
  | { kind: "busy" }
  | { kind: "waiting" }
  | { kind: "failed"; final: boolean; error: string };

// Takes the row for a few minutes, so the webhook and wati:run never work
// the same event at once.
async function lease(key: string) {
  const [row] = await db()`
    UPDATE integration_event
    SET next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    WHERE source = ${SOURCE} AND external_event_id = ${key}
      AND status IN ('received','failed') AND attempts < ${MAX_ATTEMPTS}
      AND next_attempt_at <= now()
    RETURNING id, attempts, payload`;
  return row as
    { id: string; attempts: number; payload: WatiEvent } | undefined;
}

export async function processWatiEvent(key: string): Promise<ProcessResult> {
  const row = await lease(key);
  if (!row) {
    const [e] = await db()`
      SELECT status FROM integration_event
      WHERE source = ${SOURCE} AND external_event_id = ${key}`;
    return e?.status === "processed" || e?.status === "ignored"
      ? { kind: "duplicate" }
      : { kind: "busy" };
  }
  const sql = db();
  try {
    const done = await withTransaction(() => dispatch(row.payload));
    await sql`
      UPDATE integration_event
      SET status = ${done.kind === "saved" ? "processed" : "ignored"},
          processed_at = now(), error = ${done.kind === "ignored" ? done.reason : null},
          attempts = attempts + 1, payload = ${sql.json(kept(row.payload) as never)},
          updated_at = now()
      WHERE id = ${row.id}`;
    return done;
  } catch (err) {
    const attempts = row.attempts + 1;
    const final = err instanceof NotUsable || attempts >= MAX_ATTEMPTS;
    // After the last try nothing reads the payload again, so it shrinks to
    // ids like a finished one: erase_person() does not reach this table.
    const payload = sql.json(
      (final ? kept(row.payload) : row.payload) as never,
    );
    const wait = final ? 0 : BACKOFF_SECONDS[attempts - 1];
    if (err instanceof NotYet) {
      // Stays `received` while waiting, so the health page shows no failure.
      await sql`
        UPDATE integration_event
        SET status = ${final ? "ignored" : "received"}, error = ${NOT_KNOWN},
            processed_at = ${final ? sql`now()` : null}, attempts = ${attempts},
            next_attempt_at = now() + make_interval(secs => ${wait}),
            payload = ${payload}, updated_at = now()
        WHERE id = ${row.id}`;
      return final
        ? { kind: "ignored", reason: NOT_KNOWN }
        : { kind: "waiting" };
    }
    // The message only: a database error's detail can hold a phone number.
    const error = (err instanceof Error ? err.message : String(err)).slice(
      0,
      500,
    );
    await sql`
      UPDATE integration_event
      SET status = 'failed', processed_at = now(), error = ${error},
          attempts = ${final ? MAX_ATTEMPTS : attempts},
          next_attempt_at = now() + make_interval(secs => ${wait}),
          payload = ${payload}, updated_at = now()
      WHERE id = ${row.id}`;
    return { kind: "failed", final, error };
  }
}

// Every event due a try: new ones the webhook couldn't finish, and failures
// whose wait is over. One that ran out of tries stays `failed` for people
// to look at on the integration-health page.
export async function runWatiQueue(
  batch = 50,
): Promise<{ saved: number; failed: number; lost: number }> {
  const due = await db()`
    SELECT external_event_id FROM integration_event
    WHERE source = ${SOURCE} AND status IN ('received','failed')
      AND attempts < ${MAX_ATTEMPTS} AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    LIMIT ${batch}`;
  const out = { saved: 0, failed: 0, lost: 0 };
  for (const d of due) {
    const r = await processWatiEvent(d.external_event_id as string);
    if (r.kind === "saved") out.saved++;
    else if (r.kind === "failed") out[r.final ? "lost" : "failed"]++;
  }
  return out;
}
