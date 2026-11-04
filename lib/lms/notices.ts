import { raiseEvent } from "../events/raise.ts";
import { db } from "../sql.ts";
import { lmsHandoffEnabled, type LmsNoticeKind } from "./send.ts";

// CRM → LMS notices: what goes in each message, and how one is queued.
// Contract: docs/superpowers/specs/2026-11-04-crm-to-lms-handoff.md §4.
//
// Each notice is its own `LmsNotice` outbox row, queued by the handler of
// the CRM event that caused it (lib/events/handlers.ts). Only the LmsNotice
// handler calls the LMS, so an LMS outage retries just the notice and never
// holds up the Ops tasks the same CRM event creates. The notice's outbox id
// is the message's `messageId`, which the LMS uses to ignore repeats.
//
// The message body is built when the notice is sent, not when it is queued,
// so the LMS always gets the current data.

export async function queueLmsNotice(
  kind: LmsNoticeKind,
  refId: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  if (!lmsHandoffEnabled()) return false;
  await raiseEvent("LmsNotice", refId, { kind, refId, ...extra }, null);
  return true;
}

// ---- Message bodies (§4) ------------------------------------------------------

async function classBlock(classId: string) {
  const [c] = await db()`
    SELECT c.id, c.code, c.start_date::text AS start_date,
           c.end_date::text AS end_date, c.language, c.mode, c.online_url,
           co.id AS course_id, co.name_en, co.name_zh
    FROM class c JOIN course co ON co.id = c.course_id
    WHERE c.id = ${classId}`;
  if (!c) throw new Error(`class ${classId} not found`);
  return {
    class: {
      id: c.id,
      code: c.code,
      startDate: c.start_date,
      endDate: c.end_date,
      language: c.language,
      mode: c.mode,
      onlineUrl: c.online_url ?? null,
    },
    course: { id: c.course_id, name: c.name_en, nameCn: c.name_zh ?? null },
  };
}

async function personBlock(personId: string) {
  const [p] = await db()`
    SELECT p.id, p.full_name, p.email, p.phone_e164, p.preferred_language,
           (SELECT co.legal_name FROM company_membership m
              JOIN company co ON co.id = m.company_id
             WHERE m.person_id = p.id AND m.end_date IS NULL
               AND co.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) AS company_name
    FROM person p WHERE p.id = ${personId}`;
  if (!p) throw new Error(`person ${personId} not found`);
  return {
    id: p.id as string,
    fullName: p.full_name as string,
    email: (p.email as string | null) ?? null,
    phoneE164: (p.phone_e164 as string | null) ?? null,
    companyName: (p.company_name as string | null) ?? null,
    preferredLanguage: p.preferred_language as string,
  };
}

export type BuiltMessage =
  | { kind: "send"; data: Record<string, unknown> }
  // Nothing to send, with the reason (recorded on the outbox row's handler).
  | { kind: "skip"; reason: string; personId?: string; enrolmentId?: string };

export async function buildLmsMessage(
  kind: LmsNoticeKind,
  refId: string,
  extra: Record<string, unknown>,
): Promise<BuiltMessage> {
  const sql = db();
  switch (kind) {
    case "enrolment.confirmed": {
      const [e] = await sql`
        SELECT e.id, e.status, e.payer_type, e.price_paid_myr::text AS price,
               e.person_id, e.class_id, d.funding_type,
               (SELECT max(h.changed_at) FROM enrolment_status_history h
                 WHERE h.enrolment_id = e.id AND h.to_status = 'confirmed')
                 AS confirmed_at
        FROM enrolment e LEFT JOIN deal d ON d.id = e.deal_id
        WHERE e.id = ${refId}`;
      if (!e) throw new Error(`enrolment ${refId} not found`);
      const person = await personBlock(e.person_id as string);
      // §4.1: the LMS can't make a login without an email. Ops are told
      // instead (by the caller), and adding the email later re-queues this
      // notice (PersonContactChanged).
      if (!person.email)
        return {
          kind: "skip",
          reason: "no email",
          personId: person.id,
          enrolmentId: e.id as string,
        };
      return {
        kind: "send",
        data: {
          enrolment: {
            id: e.id,
            status: e.status,
            payerType: e.payer_type,
            pricePaidMyr: e.price ?? null,
            fundingType: e.funding_type ?? null,
            confirmedAt: e.confirmed_at
              ? new Date(e.confirmed_at as string).toISOString()
              : null,
          },
          person,
          ...(await classBlock(e.class_id as string)),
        },
      };
    }

    case "enrolment.cancelled":
      return {
        kind: "send",
        data: { enrolmentId: refId, reason: extra.reason ?? null },
      };

    case "enrolment.transferred": {
      const [e] = await sql`
        SELECT e.id, e.class_id, e.transferred_to_enrolment_id, n.class_id AS to_class
        FROM enrolment e
        LEFT JOIN enrolment n ON n.id = e.transferred_to_enrolment_id
        WHERE e.id = ${refId}`;
      if (!e) throw new Error(`enrolment ${refId} not found`);
      if (!e.transferred_to_enrolment_id)
        throw new Error(
          `enrolment ${refId} has no transferred_to_enrolment_id`,
        );
      return {
        kind: "send",
        data: {
          enrolmentId: e.id,
          fromClassId: e.class_id,
          toClassId: e.to_class,
          newEnrolmentId: e.transferred_to_enrolment_id,
          ...(await classBlock(e.to_class as string)),
        },
      };
    }

    case "class.updated":
      return {
        kind: "send",
        data: {
          ...(await classBlock(refId)),
          changedFields: extra.changedFields ?? {},
        },
      };

    case "person.updated": {
      const person = await personBlock(refId);
      return {
        kind: "send",
        data: {
          personId: person.id,
          previousEmail: extra.previousEmail ?? null,
          email: person.email,
          fullName: person.fullName,
          phoneE164: person.phoneE164,
        },
      };
    }
  }
}

// Was this enrolment ever confirmed? Only those were sent to the LMS, so only
// those need a cancel notice (an expired reservation never reached it).
export async function everConfirmed(enrolmentId: string): Promise<boolean> {
  const [r] = await db()`
    SELECT 1 FROM enrolment_status_history
    WHERE enrolment_id = ${enrolmentId}
      AND to_status IN ('confirmed','onboarded','attended')
    LIMIT 1`;
  return Boolean(r);
}
