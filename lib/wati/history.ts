import { normalizePhoneE164 } from "../format/phone.ts";
import { db, withTransaction } from "../sql.ts";

// WhatsApp history import (cutover plan WP5, decided 6 Nov: option A): WATI's
// past chats into the inbox, for people ALREADY in the CRM. Moved from
// lead_sales (its PR #20) with the inbox, migration 019. WATI is the
// system of record for WhatsApp, so it is read there, not from SalesProcess.
//
//  - a chat is matched to a CRM person by phone (phone_e164). No match = the
//    chat is skipped and counted: no person is ever created here.
//  - messages keep their own time as sent_at AND created_at, and are marked
//    `imported` (migration 020): lead_sales' automations trigger skips them,
//    so an import never fires an event.
//  - owner true = we sent it (status READ / DELIVERED / SENT → read /
//    delivered / sent), false = the customer (received). Non-message events
//    (WATI's "ticket" assignment events) are skipped.
//  - safe to run again: a message is keyed on WATI's id. One the webhook saved
//    earlier carries a different id, so a message with the same direction and
//    text within 5 seconds counts as the same one and is not doubled.
//  - thread id = the customer's WhatsApp number, as the webhook uses.

export type WatiContact = {
  id: string;
  waId: string | null;
  phone: string | null;
  name: string | null;
};
export type WatiConversation = {
  id: string;
  contactId: string;
  lastUpdated: string;
};
export type WatiHistoryMessage = {
  id: string;
  eventType: string;
  owner: boolean;
  type: string;
  text: string | null;
  status: string | null;
  timestamp: string; // unix seconds
};
export type WatiReader = {
  contacts(): Promise<WatiContact[]>;
  conversations(): Promise<WatiConversation[]>;
  messages(conversationId: string): Promise<WatiHistoryMessage[]>;
};

function e164Of(c: WatiContact): string | null {
  const digits = (c.waId ?? c.phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  // WATI usually holds the country code; a few numbers were saved the local
  // way (012…), so the CRM's Malaysian default is the fallback.
  return normalizePhoneE164(`+${digits}`) ?? normalizePhoneE164(digits);
}

// What the inbox shows for a message: its text, or the kind of file with the
// caption if it has one (most images, all audio and stickers have no text).
function bodyOf(m: WatiHistoryMessage): string {
  const text = m.text?.trim() ?? "";
  if (!m.type || m.type === "text") return text || "[message]";
  return text ? `[${m.type}] ${text}` : `[${m.type}]`;
}

const OUT_STATUS: Record<string, string> = {
  READ: "read",
  REPLIED: "read",
  DELIVERED: "delivered",
  FAILED: "failed",
};

type Row = {
  direction: "in" | "out";
  ext: string;
  body: string;
  at: string;
  status: string;
};

export async function importWatiHistory(
  reader: WatiReader,
  opts: { days?: number; now?: Date },
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
  const sql = db();

  const phoneOf = new Map<string, string>();
  for (const c of await reader.contacts()) {
    const e164 = e164Of(c);
    if (e164) phoneOf.set(c.id, e164);
  }
  // The earliest person for a phone: the one the CRM treats as the original.
  const personOf = new Map<string, string>();
  for (const p of await sql`
    SELECT id, phone_e164 FROM person
    WHERE deleted_at IS NULL AND merged_into_id IS NULL AND phone_e164 IS NOT NULL
    ORDER BY created_at, id`)
    if (!personOf.has(p.phone_e164)) personOf.set(p.phone_e164, p.id);

  const since =
    opts.days === undefined
      ? null
      : (opts.now ?? new Date()).getTime() - opts.days * 86_400_000;

  for (const conv of await reader.conversations()) {
    if (since !== null && Date.parse(conv.lastUpdated) < since) {
      bump(`skip: older than ${opts.days} days`);
      continue;
    }
    const e164 = phoneOf.get(conv.contactId);
    if (!e164) {
      bump("skip: contact has no phone");
      continue;
    }
    const personId = personOf.get(e164);
    if (!personId) {
      bump("skip: no CRM person");
      continue;
    }

    const rows: Row[] = [];
    for (const m of await reader.messages(conv.id)) {
      if (m.eventType !== "message") {
        bump("skip: not a message event");
        continue;
      }
      if (!/^\d+$/.test(m.timestamp ?? "")) {
        bump("skip: no timestamp");
        continue;
      }
      rows.push({
        direction: m.owner ? "out" : "in",
        ext: m.id,
        body: bodyOf(m),
        at: new Date(Number(m.timestamp) * 1000).toISOString(),
        status: m.owner ? (OUT_STATUS[m.status ?? ""] ?? "sent") : "received",
      });
    }
    if (rows.length === 0) {
      bump("skip: no messages");
      continue;
    }
    const last = (xs: Row[]) =>
      xs
        .map((r) => r.at)
        .sort()
        .at(-1) ?? null;

    await withTransaction(async () => {
      const [c] = await sql`
        INSERT INTO conversation (person_id, channel, external_thread_id,
                                        last_message_at, last_inbound_at)
        VALUES (${personId}, 'whatsapp', ${e164.slice(1)}, ${last(rows)},
                ${last(rows.filter((r) => r.direction === "in"))})
        ON CONFLICT (channel, external_thread_id) DO UPDATE
          SET last_message_at = greatest(conversation.last_message_at, EXCLUDED.last_message_at),
              last_inbound_at = greatest(conversation.last_inbound_at, EXCLUDED.last_inbound_at)
        RETURNING id, person_id`;
      const added = await sql`
        INSERT INTO conversation_message (conversation_id, person_id, channel,
                                   direction, external_message_id, body,
                                   sent_at, created_at, status, imported)
        SELECT ${c.id}, ${c.person_id}, 'whatsapp', t.direction, t.ext, t.body,
               t.at, t.at, t.status, true
        FROM unnest(${rows.map((r) => r.direction)}::text[],
                    ${rows.map((r) => r.ext)}::text[],
                    ${rows.map((r) => r.body)}::text[],
                    ${rows.map((r) => r.at)}::timestamptz[],
                    ${rows.map((r) => r.status)}::text[])
             AS t(direction, ext, body, at, status)
        WHERE NOT EXISTS (
          SELECT 1 FROM conversation_message m
          WHERE m.conversation_id = ${c.id} AND m.direction = t.direction
            AND m.body = t.body
            AND m.sent_at BETWEEN t.at - interval '5 seconds'
                              AND t.at + interval '5 seconds')
        ON CONFLICT (channel, external_message_id) DO NOTHING
        RETURNING id`;
      bump("new message", added.length);
      bump("skip: message already there", rows.length - added.length);
    });
    bump("chats imported");
  }
  return stats;
}
