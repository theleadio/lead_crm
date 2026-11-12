import type { Viewer } from "../auth/permissions.ts";
import { conversationDetail, replyWindow } from "../inbox/service.ts";
import { db } from "../sql.ts";
import { sendText, type WatiOpts } from "./client.ts";
import { markReplied } from "./webhook.ts";

export { watiFromEnv, type WatiOpts } from "./client.ts";

// Replying on WhatsApp from the inbox, through WATI API v3 (docs.wati.io):
// free text, inside the 24-hour window only. Host only, Bearer token. Errors
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
  | { kind: "send_failed" };

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
