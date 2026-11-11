import type { Viewer } from "../auth/permissions.ts";
import { conversationDetail, replyWindow } from "../inbox/service.ts";
import { db } from "../sql.ts";
import {
  sendTemplate,
  sendText,
  WatiRefused,
  type WatiOpts,
} from "./client.ts";
import { markReplied } from "./webhook.ts";

export { watiFromEnv, type WatiOpts } from "./client.ts";

// Replying on WhatsApp from the inbox, through WATI API v3 (docs.wati.io):
// free text inside the 24-hour window, or an approved template at any time. Host only, Bearer token. Errors
// carry the status only: a body can echo the phone number. Moved from
// lead_sales (its PR #21) with the inbox, migration 019. Template sends for
// automations stay in lead_sales, which runs them.
//
// The reply is saved first as `out`, with an id of our own ("app:<uuid>").
// WATI's echo of it (lib/wati/webhook.ts) is matched by thread, text and
// time, and the row takes WATI's id, so delivery and read events find it.

export type ReplyResult =
  | { kind: "sent" }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "send_failed" }
  // Template only: WATI gave no clear answer, so it may have gone out.
  | { kind: "unknown" };

// A reply typed in the inbox. Only inside the free-reply window. The first
// one stops the reply deadline of the conversation's open enquiries.
export async function sendInboxReply(
  o: WatiOpts,
  viewer: Viewer,
  conversationId: string,
  text: string,
): Promise<ReplyResult> {
  const body = text.trim();
  if (!body || body.length > 4000)
    return { kind: "invalid", message: "Write 1 to 4,000 characters." };
  // Only a conversation this user may open (an unseen one is audited there).
  if (!(await conversationDetail(viewer, conversationId)))
    return { kind: "not_found" };
  const [c] = await db()`
    SELECT person_id, channel, external_thread_id, last_inbound_at
    FROM conversation WHERE id = ${conversationId}`;
  if (!c || c.channel !== "whatsapp") return { kind: "not_found" };
  if (replyWindow("whatsapp", c.last_inbound_at) !== "open")
    return {
      kind: "invalid",
      message:
        "The free-reply window has closed: WhatsApp needs an approved template to reply.",
    };
  const ext = `app:${crypto.randomUUID()}`;
  await db()`
    INSERT INTO conversation_message (conversation_id, person_id, channel,
      direction, external_message_id, body, status, sent_by_user_id)
    VALUES (${conversationId}, ${c.person_id}, 'whatsapp', 'out', ${ext},
            ${body}, 'queued', ${viewer.id})`;
  await db()`
    UPDATE conversation SET last_message_at = now() WHERE id = ${conversationId}`;
  try {
    await sendText(o, c.external_thread_id, body);
  } catch {
    await db()`
      UPDATE conversation_message SET status = 'failed'
      WHERE channel = 'whatsapp' AND external_message_id = ${ext}`;
    return { kind: "send_failed" };
  }
  // Only if still queued: an echo that arrived first may have taken WATI's
  // id and status already.
  await db()`
    UPDATE conversation_message SET status = 'sent'
    WHERE channel = 'whatsapp' AND external_message_id = ${ext}
      AND status = 'queued'`;
  await markReplied(conversationId);
  return { kind: "sent" };
}

export const TEMPLATE_NAME = /^[a-z0-9_]{1,100}$/;

// An approved WATI template typed in the inbox: what staff send once the
// free-reply window has closed. Saved first as `queued` under our own id,
// which goes to WATI as local_message_id. WATI refusing it (a wrong name, an
// unapproved template, a bad number) marks it failed; no clear answer
// (timeout, 5xx) keeps it queued and says so, so staff check WATI before
// sending again rather than send it twice. A sent one is staff answering:
// it stops the reply deadline, as a typed reply does.
export async function sendInboxTemplate(
  o: WatiOpts,
  viewer: Viewer,
  conversationId: string,
  template: string,
  params: { name: string; value: string }[],
): Promise<ReplyResult> {
  const name = template.trim();
  if (!TEMPLATE_NAME.test(name))
    return {
      kind: "invalid",
      message:
        "Type the template's name as it is in WATI: lowercase letters, digits and _.",
    };
  if (!(await conversationDetail(viewer, conversationId)))
    return { kind: "not_found" };
  const [c] = await db()`
    SELECT person_id, channel, external_thread_id
    FROM conversation WHERE id = ${conversationId}`;
  if (!c || c.channel !== "whatsapp") return { kind: "not_found" };
  const ext = `app:${crypto.randomUUID()}`;
  await db()`
    INSERT INTO conversation_message (conversation_id, person_id, channel,
      direction, external_message_id, body, status, sent_by_user_id)
    VALUES (${conversationId}, ${c.person_id}, 'whatsapp', 'out', ${ext},
            ${`[template ${name}]`}, 'queued', ${viewer.id})`;
  await db()`
    UPDATE conversation
    SET last_message_at = greatest(last_message_at, clock_timestamp())
    WHERE id = ${conversationId}`;
  try {
    await sendTemplate(o, c.external_thread_id, name, ext, params);
  } catch (e) {
    if (e instanceof WatiRefused) {
      await db()`
        UPDATE conversation_message SET status = 'failed'
        WHERE channel = 'whatsapp' AND external_message_id = ${ext}`;
      return { kind: "send_failed" };
    }
    return { kind: "unknown" };
  }
  await db()`
    UPDATE conversation_message SET status = 'sent'
    WHERE channel = 'whatsapp' AND external_message_id = ${ext}
      AND status = 'queued'`;
  await markReplied(conversationId);
  return { kind: "sent" };
}

// Template names sent before from the inbox or by automations, newest first:
// suggestions for the template box, so nobody has to remember them.
export async function recentTemplateNames(): Promise<string[]> {
  const rows = await db()`
    SELECT substr(body, 11, length(body) - 11) AS name,
           max(created_at) AS last
    FROM conversation_message
    WHERE channel = 'whatsapp' AND direction = 'out'
      -- "[template <name>]": the name sits between the 10-character
      -- prefix and the closing bracket; anything else is dropped below.
      AND body LIKE '[template %]'
    GROUP BY 1
    ORDER BY last DESC
    LIMIT 30`;
  return rows.map((r) => r.name as string).filter((n) => TEMPLATE_NAME.test(n));
}
