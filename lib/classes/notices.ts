import { writeAudit } from "../audit.ts";
import {
  canWriteClass,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { formatDate } from "../format/date.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { ClassNoticeRecord } from "./types.ts";

// Change notices (spec §9.9, §5 `class_notice`, §11.1 ClassChanged). Which
// edits a student has to be told about, what changed, and the first draft of
// the message Operations approves on 9.10.

// §9.9 "date/time/venue change", read as: when is it, and where do I go.
// Capacity, price, the HRDC flag and the seat threshold are not here —
// nothing a student needs told (proposal open question 2).
export const NOTICE_FIELDS = [
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "mode",
  "venueName",
  "venueAddress",
  "city",
  "onlineUrl",
] as const;
export type NoticeField = (typeof NOTICE_FIELDS)[number];

export type FieldChange = { from: string | null; to: string | null };
export type NoticeChanges = Partial<Record<NoticeField, FieldChange>>;

const norm = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

// Compares the stored row against the merged one, so re-sending a field
// unchanged is not a change and never asks for a notice decision (design 3).
export function noticeWorthyChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): NoticeChanges {
  const changes: NoticeChanges = {};
  for (const field of NOTICE_FIELDS) {
    const from = norm(before[field]);
    const to = norm(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

export const hasNoticeWorthyChange = (changes: NoticeChanges) =>
  Object.keys(changes).length > 0;

// An older pending notice keeps the value the students were last told, so a
// second edit widens the notice instead of hiding the first move (§5: one
// pending notice per class).
export function mergeChanges(
  existing: NoticeChanges,
  incoming: NoticeChanges,
): NoticeChanges {
  const merged: NoticeChanges = { ...existing };
  for (const [field, change] of Object.entries(incoming) as [
    NoticeField,
    FieldChange,
  ][]) {
    const from = merged[field]?.from ?? change.from;
    // A field edited back to where it started drops out of the notice.
    if (from === change.to) delete merged[field];
    else merged[field] = { from, to: change.to };
  }
  return merged;
}

const MODE_EN: Record<string, string> = {
  in_person: "in person",
  online: "online",
  hybrid: "in person and online",
};
const MODE_ZH: Record<string, string> = {
  in_person: "实体课",
  online: "线上课",
  hybrid: "实体与线上同步",
};

const FIELD_EN: Record<NoticeField, string> = {
  startDate: "Start date",
  endDate: "End date",
  startTime: "Start time",
  endTime: "End time",
  mode: "Format",
  venueName: "Venue",
  venueAddress: "Address",
  city: "City",
  onlineUrl: "Joining link",
};
const FIELD_ZH: Record<NoticeField, string> = {
  startDate: "开课日期",
  endDate: "结课日期",
  startTime: "开始时间",
  endTime: "结束时间",
  mode: "上课形式",
  venueName: "上课地点",
  venueAddress: "地址",
  city: "城市",
  onlineUrl: "上课链接",
};

function value(field: NoticeField, raw: string | null, zh: boolean): string {
  if (raw === null) return zh ? "（未定）" : "not set";
  if (field === "startDate" || field === "endDate")
    return formatDate(`${raw}T00:00:00Z`);
  if (field === "mode") return (zh ? MODE_ZH : MODE_EN)[raw] ?? raw;
  return raw;
}

// A first draft, not what goes out: 9.10 lets Operations edit both messages
// before approving, and nothing is sent from 9.9 (design 6).
export function draftMessages(classCode: string, changes: NoticeChanges) {
  const lines = (zh: boolean) =>
    (Object.entries(changes) as [NoticeField, FieldChange][])
      .map(
        ([field, c]) =>
          `${(zh ? FIELD_ZH : FIELD_EN)[field]}: ${value(field, c.from, zh)} → ${value(field, c.to, zh)}`,
      )
      .join("\n");

  return {
    messageEn: `Hello, there is a change to your class ${classCode}.\n\n${lines(false)}\n\nEverything else stays the same. Reply to this message if you have any question.`,
    messageZh: `您好，您报名的课程 ${classCode} 有以下更动。\n\n${lines(true)}\n\n其他安排不变。如有疑问，请直接回复此信息。`,
  };
}

// Writes the pending notice for an edit, inside the caller's transaction and
// under the class row lock it already holds (design 4, 5). §5 allows one
// pending notice per class, so a second notice-worthy edit widens the one
// that is there instead of making a second.
export async function upsertPendingNotice(
  classId: string,
  classCode: string,
  incoming: NoticeChanges,
  recipientCount: number,
  viewer: Viewer,
): Promise<string | null> {
  const sql = db();
  const [existing] = await sql`
    SELECT id, changed_fields FROM class_notice
    WHERE class_id = ${classId} AND status = 'pending'
    FOR UPDATE`;

  const changes = existing
    ? mergeChanges(existing.changed_fields as NoticeChanges, incoming)
    : incoming;

  // Every change undone again: nothing left to tell anyone.
  if (!hasNoticeWorthyChange(changes)) {
    if (existing)
      await sql`UPDATE class_notice SET status = 'discarded' WHERE id = ${existing.id}`;
    return null;
  }

  const { messageEn, messageZh } = draftMessages(classCode, changes);
  const [notice] = existing
    ? await sql`
        UPDATE class_notice
        SET changed_fields = ${sql.json(changes)},
            message_en = ${messageEn}, message_zh = ${messageZh},
            recipient_count = ${recipientCount}
        WHERE id = ${existing.id}
        RETURNING id`
    : await sql`
        INSERT INTO class_notice (class_id, changed_fields, message_en,
                                  message_zh, recipient_count, created_by)
        VALUES (${classId}, ${sql.json(changes)}, ${messageEn}, ${messageZh},
                ${recipientCount}, ${viewer.id})
        RETURNING id`;

  // §11.1: raised in the same transaction as the edit. Shawn's worker sends
  // only after Operations approves on 9.10.
  await sql`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
    VALUES ('ClassChanged', 'class', ${classId},
            ${sql.json({ classId, changedFields: changes, noticeId: notice.id })},
            ${viewer.id})`;
  return notice.id as string;
}

// ---------------------------------------------------------------------------
// The life of a notice after 9.9 created it (spec §9.10 Notices, §7.1).
// Sending is Shawn's worker's job: `status = 'sent'`, `sent_at` and
// `send_error` are its columns (§12.11), read here and never written.
// ---------------------------------------------------------------------------

// GET /api/classes/:id/notices — readable by every role that reads the class
// (§6 course/class row). Pending first, then newest first.
export async function listClassNotices(
  classId: string,
  viewer: Viewer,
): Promise<ClassNoticeRecord[]> {
  requirePermission(viewer, "class", "read");
  if (!isUuid(classId)) return [];
  const rows = await db()`
    SELECT n.id, n.status, n.changed_fields, n.message_en, n.message_zh,
           n.recipient_count, n.created_at, n.approved_at, n.sent_at,
           n.send_error,
           c.full_name AS created_by_name, a.full_name AS approved_by_name
    FROM class_notice n
    LEFT JOIN app_user c ON c.id = n.created_by
    LEFT JOIN app_user a ON a.id = n.approved_by
    WHERE n.class_id = ${classId}
    ORDER BY (n.status = 'pending') DESC, n.created_at DESC`;

  return rows.map((r) => ({
    id: r.id as string,
    status: r.status as string,
    changedFields: r.changed_fields as ClassNoticeRecord["changedFields"],
    messageEn: r.message_en as string | null,
    messageZh: r.message_zh as string | null,
    recipientCount: r.recipient_count as number,
    createdByName: r.created_by_name as string | null,
    createdAt: new Date(r.created_at as string).toISOString(),
    approvedByName: r.approved_by_name as string | null,
    approvedAt:
      r.approved_at === null
        ? null
        : new Date(r.approved_at as string).toISOString(),
    sentAt:
      r.sent_at === null ? null : new Date(r.sent_at as string).toISOString(),
    sendError: r.send_error as string | null,
  }));
}

export type NoticeWriteResult =
  | { kind: "ok"; id: string; classId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  // The notice is approved, sent or discarded: its wording is what the
  // students were told, so it can never be rewritten or sent twice (§9.10).
  | { kind: "not_pending"; status: string };

// A conditional UPDATE is the state machine: zero rows back means the notice
// moved on, or was never there, and one existence check tells those apart
// (design 7). Two operators approving at once: the second gets not_pending.
async function whyNoRow(id: string): Promise<NoticeWriteResult> {
  const [row] = await db()`SELECT status FROM class_notice WHERE id = ${id}`;
  return row
    ? { kind: "not_pending", status: row.status as string }
    : { kind: "not_found" };
}

// PATCH /api/class-notices/:id — correct the wording, nothing else.
// `changed_fields` and `recipient_count` are what the notice is about and
// who it was prepared for; an edit leaves both alone (§9.10).
export async function editNotice(
  id: string,
  patch: { messageEn?: string; messageZh?: string },
  viewer: Viewer,
): Promise<NoticeWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<NoticeWriteResult> => {
    const sql = db();
    const set: Record<string, string> = {};
    if (patch.messageEn !== undefined) set.message_en = patch.messageEn;
    if (patch.messageZh !== undefined) set.message_zh = patch.messageZh;
    const columns = Object.keys(set);

    const [before] = await sql`
      SELECT class_id, status, message_en, message_zh FROM class_notice
      WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (before.status !== "pending")
      return { kind: "not_pending", status: before.status as string };
    if (!columns.length)
      return { kind: "ok", id, classId: before.class_id as string };

    // Stored as typed: the draft is a first draft, and Operations' wording
    // is never re-drafted by the server (§9.10).
    const [updated] = await sql`
      UPDATE class_notice SET ${sql(set, columns)}
      WHERE id = ${id} AND status = 'pending'
      RETURNING class_id`;
    if (!updated) return whyNoRow(id);

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class_notice",
      entityId: id,
      before: {
        message_en: before.message_en ?? null,
        message_zh: before.message_zh ?? null,
      },
      after: set,
    });
    return { kind: "ok", id, classId: updated.class_id as string };
  });
}

// POST /api/class-notices/:id/approve — §7.1, §11.1. Approving hands the
// notice to Shawn's worker and sends nothing itself.
export async function approveNotice(
  id: string,
  viewer: Viewer,
): Promise<NoticeWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<NoticeWriteResult> => {
    const sql = db();
    const [updated] = await sql`
      UPDATE class_notice
      SET status = 'approved', approved_by = ${viewer.id}, approved_at = now()
      WHERE id = ${id} AND status = 'pending'
      RETURNING class_id, recipient_count`;
    if (!updated) return whyNoRow(id);
    const classId = updated.class_id as string;

    // §11.1 ClassNoticeApproved, in the same transaction as the approval.
    // `sent_at` and `status = 'sent'` stay the worker's to write (§12.11).
    await sql`
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
      VALUES ('ClassNoticeApproved', 'class_notice', ${id},
              ${sql.json({ noticeId: id, classId })}, ${viewer.id})`;

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class_notice",
      entityId: id,
      before: { status: "pending" },
      after: { status: "approved", recipient_count: updated.recipient_count },
    });
    return { kind: "ok", id, classId };
  });
}

// POST /api/class-notices/:id/discard — stops the notice and frees the class
// for the next one (§5 allows one pending notice per class). No event: nobody
// has to be told about a message that was never sent.
export async function discardNotice(
  id: string,
  viewer: Viewer,
): Promise<NoticeWriteResult> {
  if (!canWriteClass(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<NoticeWriteResult> => {
    const [updated] = await db()`
      UPDATE class_notice SET status = 'discarded'
      WHERE id = ${id} AND status = 'pending'
      RETURNING class_id`;
    if (!updated) return whyNoRow(id);

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "class_notice",
      entityId: id,
      before: { status: "pending" },
      after: { status: "discarded" },
    });
    return { kind: "ok", id, classId: updated.class_id as string };
  });
}
