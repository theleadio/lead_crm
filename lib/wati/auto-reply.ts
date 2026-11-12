import { countFrom, isOfficeHours } from "../enquiries/deadline.ts";
import { loadHolidays } from "../enquiries/routing.ts";
import { db } from "../sql.ts";
import { sendText, type WatiOpts } from "./client.ts";

// The WhatsApp after-hours auto-reply (decided 4 Nov): "Thanks, we'll reply
// by the next working day", once per conversation per evening, in the class
// language or else the person's.
//
//  - After hours: outside Mon–Fri 08:30–16:30 Malaysia time, holidays off
//    (lib/enquiries/deadline.ts, the same rule as the reply deadline).
//  - Once per stretch: a stretch runs from closing to the next opening; the
//    thread remembers the opening of the stretch it was answered in
//    (conversation.after_hours_reply_until, migration 021), claimed before
//    sending so two messages at once can't both send.
//  - Free text: the customer has just written, so the 24-hour window is
//    open. A message read late (a retried event) is answered only while it
//    is still after hours and within the hour.
//  - Language: the class of the person's latest live enrolment, else their
//    preferred language.
//  - Saved in the inbox as `automated` (migration 021), so WATI's echo is
//    matched to it and does not count as staff's first response.
//
// Called after the webhook has saved the message, outside its transaction:
// a send is never inside a transaction that could roll back and send again.
// Never throws: a failed auto-reply is logged and the message is unaffected.

// The wording is to be checked by Marketing, the Chinese above all.
export const AFTER_HOURS_TEXT: Record<"en" | "zh", string> = {
  en: "Thanks for your message! Our office is closed now. We'll reply by the next working day (Monday to Friday, 8:30 AM to 4:30 PM, Malaysia time).",
  zh: "感谢您的留言！我们现在已下班，将在下一个工作日回复您（星期一至星期五，上午8:30至下午4:30，马来西亚时间）。",
};

const LATE_LIMIT_MS = 60 * 60 * 1000;

export type AutoReplyResult =
  | "sent"
  | "office_hours"
  | "too_late"
  | "already_replied"
  | "not_configured"
  | "failed";

async function languageOf(personId: string): Promise<"en" | "zh"> {
  const [r] = await db()`
    SELECT coalesce(
             (SELECT cl.language FROM enrolment en
              JOIN class cl ON cl.id = en.class_id
              WHERE en.person_id = ${personId}
                AND en.status IN ('reserved','payment_pending','waitlisted',
                                  'confirmed','onboarded','attended')
              ORDER BY en.created_at DESC LIMIT 1),
             p.preferred_language) AS language
    FROM person p WHERE p.id = ${personId}`;
  return r?.language === "zh" ? "zh" : "en";
}

export async function afterHoursReply(
  o: WatiOpts | undefined,
  conversationId: string,
  messageAt: Date,
  now: Date = new Date(),
): Promise<AutoReplyResult> {
  if (!o) return "not_configured";
  try {
    const holidays = await loadHolidays();
    if (isOfficeHours(messageAt, holidays)) return "office_hours";
    if (
      isOfficeHours(now, holidays) ||
      now.getTime() - messageAt.getTime() > LATE_LIMIT_MS
    )
      return "too_late";
    const opening = countFrom(messageAt, holidays);

    // Claimed and committed first: the next message in this stretch finds it.
    const [c] = await db()`
      UPDATE conversation SET after_hours_reply_until = ${opening}
      WHERE id = ${conversationId} AND channel = 'whatsapp'
        AND (after_hours_reply_until IS NULL
             OR after_hours_reply_until < ${opening})
      RETURNING person_id, external_thread_id`;
    if (!c) return "already_replied";

    const text = AFTER_HOURS_TEXT[await languageOf(c.person_id as string)];
    // An id of our own, as an inbox reply has: WATI's echo is matched to
    // this row by thread, text and time (lib/wati/webhook.ts).
    const ext = `app:${crypto.randomUUID()}`;
    await db()`
      INSERT INTO conversation_message (conversation_id, person_id, channel,
        direction, external_message_id, body, status, automated)
      VALUES (${conversationId}, ${c.person_id}, 'whatsapp', 'out', ${ext},
              ${text}, 'queued', true)`;
    try {
      await sendText(o, c.external_thread_id as string, text);
    } catch (e) {
      await db()`
        UPDATE conversation_message SET status = 'failed'
        WHERE channel = 'whatsapp' AND external_message_id = ${ext}`;
      console.error(
        `wati: after-hours reply not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "failed";
    }
    await db()`
      UPDATE conversation_message SET status = 'sent'
      WHERE channel = 'whatsapp' AND external_message_id = ${ext}
        AND status = 'queued'`;
    await db()`
      UPDATE conversation
      SET last_message_at = greatest(last_message_at, clock_timestamp())
      WHERE id = ${conversationId}`;
    return "sent";
  } catch (e) {
    console.error(
      `wati: after-hours reply failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return "failed";
  }
}
