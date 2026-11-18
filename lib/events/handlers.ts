import type postgres from "postgres";
import { z } from "zod";
import { dutySuperAdmin } from "../people/duplicate-review.ts";
import { db } from "../sql.ts";
import type { EventType } from "./types.ts";

export type EventHandler = (event: {
  id: string;
  type: string;
  aggregateId: string;
  payload: unknown;
}) => Promise<void>;

// Outside calls a handler needs, injectable so tests (and a later real
// implementation) can swap them. Default: do nothing.
export type Ports = {
  // Expire an open Stripe Checkout session. The default is a no-op until
  // Stripe test keys exist (spec O36); the real one must treat "already
  // expired or completed" as success, because a handler can run twice.
  expireCheckoutSession: (sessionId: string) => Promise<void>;
};

const uuid = z.uuid();
const enrolmentCancelled = z.object({ enrolmentId: uuid, reason: z.string() });
const classCancelled = z.object({
  classId: uuid,
  reason: z.string(),
  enrolmentIds: z.array(uuid),
});
const classNoticeApproved = z.object({ noticeId: uuid, classId: uuid });
const classChanged = z.object({
  classId: uuid,
  changedFields: z.record(z.string(), z.unknown()),
  noticeId: uuid.nullable(), // null = Ops saved quietly (spec §11.1, v1.10)
});

// Spec §11.1 "Shawn does", first version: there is no email or WhatsApp
// channel, so everything that needs a person becomes a task for Ops. A handler
// runs inside the drain's savepoint and may run twice for one event, so every
// task carries a source_key (migration 011) and the repeat inserts nothing.
async function opsTask(
  key: string,
  title: string,
  enrolment: postgres.Row,
  notes: string,
) {
  // Assigned to the duty super_admin (O37): Home's "My tasks" lists only
  // assigned tasks, so an unassigned one would be invisible. Same rule as the
  // duplicate-review task; null only in a database with no active super_admin.
  await db()`
    INSERT INTO task (type, title, person_id, enrolment_id, assigned_user_id,
                      due_at, notes, source_key)
    VALUES ('other', ${title}, ${enrolment.person_id}, ${enrolment.id},
            ${await dutySuperAdmin()}, now(), ${notes}, ${key})
    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
}

export function makeHandlers(
  ports: Ports = { expireCheckoutSession: async () => {} },
): Partial<Record<EventType, EventHandler>> {
  return {
    // Ops are told, except for the two reasons that already have their own
    // path. The student is never messaged.
    EnrolmentCancelled: async (e) => {
      const p = enrolmentCancelled.parse(e.payload);
      if (p.reason === "class_cancelled" || p.reason === "reservation_expired")
        return;
      const [enrolment] = await db()`
        SELECT id, person_id FROM enrolment WHERE id = ${p.enrolmentId}`;
      if (!enrolment) throw new Error(`enrolment ${p.enrolmentId} not found`);
      await opsTask(
        `${e.id}:cancelled`,
        "Enrolment cancelled: check refund and follow up",
        enrolment,
        `Reason: ${p.reason}`,
      );
    },

    // One "tell the student once" task per enrolment; one refund task where
    // money is still held; and the open Checkout link of an unpaid
    // reservation is expired through the port.
    ClassCancelled: async (e) => {
      const p = classCancelled.parse(e.payload);
      const ids = [...new Set(p.enrolmentIds)];
      if (!ids.length) return;
      const rows = await db()`
        SELECT e.id, e.person_id, d.checkout_session_id,
               (SELECT sum(net_myr) FROM payment_net n WHERE n.enrolment_id = e.id) AS net_myr
        FROM enrolment e LEFT JOIN deal d ON d.id = e.deal_id
        WHERE e.id = ANY(${ids}::uuid[])
        ORDER BY e.id`;
      if (rows.length !== ids.length)
        throw new Error(
          "ClassCancelled lists an enrolment that does not exist",
        );
      const sessions = new Set<string>();
      for (const r of rows) {
        await opsTask(
          `${e.id}:tell:${r.id}`,
          "Class cancelled: tell the student",
          r,
          `Reason: ${p.reason}. No email or WhatsApp channel yet; tell them by hand, once.`,
        );
        if (Number(r.net_myr) > 0)
          await opsTask(
            `${e.id}:refund:${r.id}`,
            "Class cancelled: refund needed",
            r,
            `Paid RM${r.net_myr} net. Refund in Stripe or the bank, then record it on the payment.`,
          );
        else if (r.checkout_session_id) sessions.add(r.checkout_session_id);
      }
      for (const s of sessions) await ports.expireCheckoutSession(s);
    },

    // Stopgap until email sends through Resend: one "send the notice" task per
    // student who is actually coming. Same recipients as the notice's count
    // (RECIPIENT_STATUSES in lib/classes/service.ts). The notice stays
    // 'approved'; `sent_at` is for the real sender.
    ClassNoticeApproved: async (e) => {
      const p = classNoticeApproved.parse(e.payload);
      const [notice] = await db()`
        SELECT message_en, message_zh FROM class_notice
        WHERE id = ${p.noticeId} AND class_id = ${p.classId}`;
      if (!notice) throw new Error(`class_notice ${p.noticeId} not found`);
      const rows = await db()`
        SELECT id, person_id FROM enrolment
        WHERE class_id = ${p.classId}
          AND status IN ('confirmed', 'onboarded', 'attended')
        ORDER BY id`;
      const message = [notice.message_en, notice.message_zh]
        .filter(Boolean)
        .join("\n\n");
      for (const r of rows)
        await opsTask(
          `${e.id}:notice:${r.id}`,
          "Class changed: send the student the approved notice",
          r,
          `No email channel yet; send this by hand, once.\n\n${message}`,
        );
    },

    // "Clears the schedule cache": no schedule cache exists yet (the public
    // schedule route is not built), so there is nothing to clear. The payload
    // is still checked so a malformed event is not silently swallowed.
    ClassChanged: async (e) => {
      classChanged.parse(e.payload);
    },
  };
}

// Spec §11.1 consumers register here by event type. A type with no handler is
// simply marked processed.
export const handlers = makeHandlers();
