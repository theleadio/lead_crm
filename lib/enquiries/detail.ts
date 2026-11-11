import { writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { displayName } from "../people/types.ts";
import { db } from "../sql.ts";
import { enquiryAccessSql } from "./access.ts";
import { enquiryRow } from "./list.ts";
import type { EnquiryRow } from "./types.ts";

// GET /enquiries/:id — one enquiry with its history, notes and the messages
// of its conversation (migration 019). Access is the queue's
// (lib/enquiries/access.ts): an enquiry the viewer may not see is null, as if
// missing, and the refusal is audited.

export type EnquiryDetail = {
  row: EnquiryRow;
  summary: string | null;
  resolution: string | null;
  person: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  conversationId: string | null;
  previous: { id: string; number: string } | null;
  followUps: { id: string; number: string }[];
  events: {
    id: string;
    at: string;
    kind: string;
    userName: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    note: string | null;
  }[];
  messages: {
    id: string;
    direction: "in" | "out";
    body: string | null;
    sentAt: string;
    senderName: string | null;
    attachments: number;
  }[];
};

export async function enquiryDetail(
  viewer: Viewer,
  id: string,
): Promise<EnquiryDetail | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [e] = await sql`
    SELECT e.id, e.summary, e.resolution, e.conversation_id,
           e.previous_enquiry_id, prev.number AS previous_number,
           p.id AS person_id, p.full_name, p.email, p.phone_e164, p.phone
    FROM enquiry e
    JOIN person p ON p.id = e.person_id
    LEFT JOIN enquiry prev ON prev.id = e.previous_enquiry_id
    WHERE e.id = ${id} AND ${enquiryAccessSql(sql, viewer, "read")}`;
  if (!e) {
    const [exists] = await sql`SELECT 1 FROM enquiry WHERE id = ${id}`;
    if (exists)
      await writeAudit({
        userId: viewer.id,
        action: "permission_denied",
        entity: "enquiry",
        entityId: id,
        before: null,
        after: null,
      });
    return null;
  }
  const [row, events, messages, followUps] = await Promise.all([
    enquiryRow(id),
    sql`
      SELECT ev.id, ev.created_at, ev.kind, ev.before, ev.after, ev.note,
             u.full_name AS user_name
      FROM enquiry_event ev LEFT JOIN app_user u ON u.id = ev.user_id
      WHERE ev.enquiry_id = ${id}
      ORDER BY ev.created_at, ev.id`,
    e.conversation_id
      ? sql`
          SELECT m.id, m.direction, m.body, m.sent_at,
                 cardinality(m.attachment_paths) AS attachments,
                 u.full_name AS sender_name
          FROM conversation_message m
          LEFT JOIN app_user u ON u.id = m.sent_by_user_id
          WHERE m.conversation_id = ${e.conversation_id}
          ORDER BY m.sent_at, m.created_at`
      : [],
    sql`
      SELECT id, number FROM enquiry WHERE previous_enquiry_id = ${id}
      ORDER BY created_at`,
  ]);
  const iso = (d: unknown) => new Date(d as string).toISOString();
  return {
    row: row!,
    summary: (e.summary as string | null) ?? null,
    resolution: (e.resolution as string | null) ?? null,
    person: {
      id: e.person_id as string,
      name: displayName(e.full_name as string, e.phone as string | null),
      email: (e.email as string | null) ?? null,
      phone: ((e.phone_e164 ?? e.phone) as string | null) ?? null,
    },
    conversationId: (e.conversation_id as string | null) ?? null,
    previous: e.previous_enquiry_id
      ? {
          id: e.previous_enquiry_id as string,
          number: e.previous_number as string,
        }
      : null,
    followUps: followUps.map((f) => ({
      id: f.id as string,
      number: f.number as string,
    })),
    events: events.map((ev) => ({
      id: ev.id as string,
      at: iso(ev.created_at),
      kind: ev.kind as string,
      userName: (ev.user_name as string | null) ?? null,
      before: (ev.before as Record<string, unknown> | null) ?? null,
      after: (ev.after as Record<string, unknown> | null) ?? null,
      note: (ev.note as string | null) ?? null,
    })),
    messages: messages.map((m) => ({
      id: m.id as string,
      direction: m.direction as "in" | "out",
      body: (m.body as string | null) ?? null,
      sentAt: iso(m.sent_at),
      senderName: (m.sender_name as string | null) ?? null,
      attachments: Number(m.attachments ?? 0),
    })),
  };
}
