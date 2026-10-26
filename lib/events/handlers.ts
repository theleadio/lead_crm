import type postgres from "postgres";
import { z } from "zod";
import { dutySuperAdmin } from "../people/duplicate-review.ts";
import { expireCheckoutSession } from "../integrations/stripe-api.ts";
import { db } from "../sql.ts";
import type { EventType } from "./types.ts";

export type EventHandler = (event: {
  id: string;
  type: string;
  aggregateId: string;
  payload: unknown;
}) => Promise<void>;

// Outside calls a handler needs, injectable so tests (and a later real
// implementation) can swap them. Default: the real Stripe call, which does
// nothing while STRIPE_SECRET_KEY is unset (lib/integrations/stripe-api.ts).
export type Ports = {
  // Expire an open Stripe Checkout session. The default is a no-op until
  // STRIPE_SECRET_KEY is set (spec O36); the real one treats "already
  // expired or completed" as success, because a handler can run twice.
  expireCheckoutSession: (sessionId: string) => Promise<void>;
};

// Cancellations the system makes itself, each with its own path or nothing to
// follow up: a class cancel (ClassCancelled covers it), an expired hold, and
// an expired Stripe Checkout link (the student simply did not pay).
const AUTOMATIC_REASONS = [
  "class_cancelled",
  "reservation_expired",
  "checkout_expired",
];

const uuid = z.uuid();
const enrolmentCancelled = z.object({ enrolmentId: uuid, reason: z.string() });
const classCancelled = z.object({
  classId: uuid,
  reason: z.string(),
  enrolmentIds: z.array(uuid),
});
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
  ports: Ports = {
    expireCheckoutSession: (id) => expireCheckoutSession(id),
  },
): Partial<Record<EventType, EventHandler>> {
  return {
    // Ops are told, except for the two reasons that already have their own
    // path. The student is never messaged.
    EnrolmentCancelled: async (e) => {
      const p = enrolmentCancelled.parse(e.payload);
      if (AUTOMATIC_REASONS.includes(p.reason)) return;
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
      const sessions = new Map<string, postgres.Row>();
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
        else if (r.checkout_session_id) sessions.set(r.checkout_session_id, r);
      }
      // The notice and refund tasks above never depend on Stripe: a failed
      // expire call (rotated key, stale test id, outage) becomes an Ops task
      // to expire the link by hand, not a rollback of everything. Log only the
      // event id and the HTTP status.
      for (const [s, r] of sessions) {
        try {
          await ports.expireCheckoutSession(s);
        } catch (err) {
          console.error(
            "expire checkout session failed",
            e.id,
            (err as { status?: number }).status ?? "no-status",
          );
          await opsTask(
            `${e.id}:expire:${s}`,
            "Class cancelled: expire this Checkout link by hand",
            r,
            `Stripe would not expire Checkout session ${s}. Expire it in the Stripe dashboard so nobody can pay for a cancelled class.`,
          );
        }
      }
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
