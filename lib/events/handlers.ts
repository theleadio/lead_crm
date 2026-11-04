import type postgres from "postgres";
import { z } from "zod";
import {
  buildLmsMessage,
  everConfirmed,
  queueLmsNotice,
} from "../lms/notices.ts";
import {
  makeLmsSender,
  type LmsNoticeKind,
  type LmsSender,
} from "../lms/send.ts";
import { dutySuperAdmin } from "../people/duplicate-review.ts";
import { db } from "../sql.ts";
import { raiseEvent } from "./raise.ts";
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
  // Send one CRM → LMS notice (lib/lms/send.ts). Default: the real signed
  // client, configured by LMS_WEBHOOK_URL / LMS_WEBHOOK_SECRET. Notices are
  // only queued while LMS_HANDOFF_ENABLED is "true" (lib/lms/notices.ts).
  sendToLms?: LmsSender;
};

const uuid = z.uuid();
const enrolmentCancelled = z.object({ enrolmentId: uuid, reason: z.string() });
const enrolmentRef = z.object({ enrolmentId: uuid });
const personContactChanged = z.object({
  personId: uuid,
  previousEmail: z.string().nullable(),
  email: z.string().nullable(),
});
const lmsNotice = z
  .object({
    kind: z.enum([
      "enrolment.confirmed",
      "enrolment.cancelled",
      "enrolment.transferred",
      "class.updated",
      "person.updated",
    ]),
    refId: uuid,
  })
  .loose();
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
  ports: Ports = { expireCheckoutSession: async () => {} },
): Partial<Record<EventType, EventHandler>> {
  const sendToLms = ports.sendToLms ?? makeLmsSender();
  return {
    // CRM → LMS (handoff spec §4.1): the LMS makes the account and adds the
    // student to the class.
    EnrolmentConfirmed: async (e) => {
      const p = enrolmentRef.parse(e.payload);
      await queueLmsNotice("enrolment.confirmed", p.enrolmentId);
    },

    // Handoff spec §4.3.
    EnrolmentTransferred: async (e) => {
      const p = enrolmentRef.parse(e.payload);
      await queueLmsNotice("enrolment.transferred", p.enrolmentId);
    },

    // The CRM is the master for contact details (lead_sales spec §7.2).
    // An email added where there was none means the LMS never got this
    // student (§4.1 skips a person with no email), so their live enrolments
    // are sent now; otherwise the LMS is told what changed (§4.5).
    PersonContactChanged: async (e) => {
      const p = personContactChanged.parse(e.payload);
      if (!p.previousEmail && p.email) {
        const live = await db()`
          SELECT e.id FROM enrolment e JOIN class c ON c.id = e.class_id
          WHERE e.person_id = ${p.personId}
            AND e.status IN ('confirmed','onboarded')
            AND c.end_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          ORDER BY e.id`;
        for (const r of live)
          await queueLmsNotice("enrolment.confirmed", r.id as string);
        return;
      }
      if (p.previousEmail)
        await queueLmsNotice("person.updated", p.personId, {
          previousEmail: p.previousEmail,
        });
    },

    // The only handler that calls the LMS. A non-2xx answer throws, so the
    // drain retries with its backoff and dead-letters after the last try.
    LmsNotice: async (e) => {
      const p = lmsNotice.parse(e.payload);
      const { kind, refId, ...extra } = p as {
        kind: LmsNoticeKind;
        refId: string;
      } & Record<string, unknown>;
      const built = await buildLmsMessage(kind, refId, extra);
      if (built.kind === "skip") {
        if (built.enrolmentId && built.personId)
          await opsTask(
            `${e.id}:lms-no-email`,
            "Add an email so the LMS account can be made",
            {
              id: built.enrolmentId,
              person_id: built.personId,
            } as postgres.Row,
            "The student has no email, so the LMS can't create their login. Adding one sends them to the LMS automatically.",
          );
        return;
      }
      await sendToLms({
        messageId: e.id,
        type: kind,
        sentAt: new Date().toISOString(),
        data: built.data,
      });
      // Onboarding starts from this, so the account and the temp-password
      // email already exist when the student gets the link.
      if (kind === "enrolment.confirmed")
        await raiseEvent(
          "LmsAccountReady",
          refId,
          { enrolmentId: refId },
          null,
        );
    },

    // Ops are told, except for the two reasons that already have their own
    // path. The student is never messaged. The LMS is told whenever the
    // student had been confirmed, so it was ever sent there (handoff §4.2).
    EnrolmentCancelled: async (e) => {
      const p = enrolmentCancelled.parse(e.payload);
      if (await everConfirmed(p.enrolmentId))
        await queueLmsNotice("enrolment.cancelled", p.enrolmentId, {
          reason: p.reason,
        });
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

    // "Clears the schedule cache": no schedule cache exists yet (the public
    // schedule route is not built), so there is nothing to clear. The payload
    // is still checked so a malformed event is not silently swallowed.
    // The LMS keeps its cohort in step (handoff spec §4.4).
    ClassChanged: async (e) => {
      const p = classChanged.parse(e.payload);
      await queueLmsNotice("class.updated", p.classId, {
        changedFields: p.changedFields,
      });
    },
  };
}

// Spec §11.1 consumers register here by event type. A type with no handler is
// simply marked processed.
export const handlers = makeHandlers();
