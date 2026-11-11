import { writeAudit } from "../audit.ts";
import type { Role, Viewer } from "../auth/permissions.ts";
import { enquiryAccessSql } from "../enquiries/access.ts";
import { createEnquiry, type CreateResult } from "../enquiries/create.ts";
import { suggestCategory } from "../enquiries/routing.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";

// The inbox (migration 019, from the lead_sales ticket design §4–§6): one list
// of customer conversations from every channel. Today the website help form
// feeds it; WhatsApp (WATI), Messenger, Instagram and email join the same
// tables (`conversation`, `conversation_message`) as each is connected.
//
// Who sees conversations (decided 4 Nov): support and sales, super_admin and
// management see all of them; anyone else sees only conversations with an
// enquiry of one of their teams.

export const CONVERSATION_CHANNELS = [
  "whatsapp",
  "email",
  "messenger",
  "instagram",
  "web_form",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export const CONVERSATION_STATUSES = ["open", "snoozed", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

const SEE_ALL: readonly Role[] = [
  "super_admin",
  "management",
  "support",
  "sales",
];
export const seesWholeInbox = (role: Role) => SEE_ALL.includes(role);

// WhatsApp and Messenger allow free-form replies only for a while after the
// customer's last message. 24 hours is the window as understood when this was
// written; check it against Meta's current documentation before replies are
// built.
export const REPLY_WINDOW_HOURS = 24;
const WINDOWED: readonly ConversationChannel[] = [
  "whatsapp",
  "messenger",
  "instagram",
];

export function replyWindow(
  channel: ConversationChannel,
  lastInboundAt: Date | null,
  now: Date = new Date(),
): "open" | "closed" | "not_applicable" {
  if (!WINDOWED.includes(channel)) return "not_applicable";
  if (!lastInboundAt) return "closed";
  return now.getTime() - lastInboundAt.getTime() < REPLY_WINDOW_HOURS * 3600_000
    ? "open"
    : "closed";
}

// "This viewer may see conversation c".
function visible(viewer: Viewer) {
  const sql = db();
  if (seesWholeInbox(viewer.role)) return sql`true`;
  return sql`EXISTS (
    SELECT 1 FROM enquiry e
    JOIN team_member m ON m.team_id = e.team_id AND m.user_id = ${viewer.id}
    WHERE e.conversation_id = c.id)`;
}

// Whether the inbox link shows: everyone who sees it whole, and any team
// member (who may have conversations through their team's enquiries).
export async function mayUseInbox(viewer: Viewer): Promise<boolean> {
  if (seesWholeInbox(viewer.role)) return true;
  const [m] = await db()`
    SELECT 1 FROM team_member WHERE user_id = ${viewer.id} LIMIT 1`;
  return Boolean(m);
}

// ---- List ---------------------------------------------------------------------

export type InboxFilter = {
  channel?: ConversationChannel | "all";
  who?: "mine" | "unassigned" | "all";
  status?: ConversationStatus | "all";
  needsReply?: boolean;
  limit?: number;
};

export type InboxItem = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  personName: string;
  assigneeName: string | null;
  lastMessageAt: Date | null;
  lastDirection: "in" | "out" | null;
  preview: string | null;
  openEnquiries: number;
};

export async function listConversations(
  viewer: Viewer,
  f: InboxFilter = {},
): Promise<InboxItem[]> {
  const sql = db();
  const channel = f.channel && f.channel !== "all" ? f.channel : null;
  const status = f.status ?? "open";
  const who = f.who ?? "all";
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 300);
  const rows = await sql`
    SELECT c.id, c.channel, c.status, c.last_message_at,
           p.full_name AS person_name, u.full_name AS assignee_name,
           last.direction AS last_direction, left(last.body, 140) AS preview,
           (SELECT count(*)::int FROM enquiry e
            WHERE e.conversation_id = c.id
              AND e.status IN ('open','waiting_customer')) AS open_enquiries
    FROM conversation c
    JOIN person p ON p.id = c.person_id
    LEFT JOIN app_user u ON u.id = c.assigned_user_id
    LEFT JOIN LATERAL (
      SELECT direction, body FROM conversation_message m
      WHERE m.conversation_id = c.id
      ORDER BY m.sent_at DESC, m.created_at DESC LIMIT 1
    ) last ON true
    WHERE ${visible(viewer)}
      AND p.deleted_at IS NULL
      ${channel ? sql`AND c.channel = ${channel}` : sql``}
      ${status !== "all" ? sql`AND c.status = ${status}` : sql``}
      ${who === "mine" ? sql`AND c.assigned_user_id = ${viewer.id}` : sql``}
      ${who === "unassigned" ? sql`AND c.assigned_user_id IS NULL` : sql``}
      ${f.needsReply ? sql`AND last.direction = 'in'` : sql``}
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    personName: r.person_name,
    assigneeName: r.assignee_name,
    lastMessageAt: r.last_message_at,
    lastDirection: r.last_direction,
    preview: r.preview,
    openEnquiries: r.open_enquiries,
  }));
}

// ---- One conversation ---------------------------------------------------------

export type ConversationDetail = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  assignedUserId: string | null;
  assigneeName: string | null;
  lastInboundAt: Date | null;
  replyWindow: ReturnType<typeof replyWindow>;
  person: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    preferredLanguage: string | null;
    needsReview: boolean;
  };
  messages: {
    id: string;
    direction: "in" | "out";
    body: string | null;
    sentAt: Date;
    status: string;
    senderName: string | null;
    attachments: number;
  }[];
  // Every enquiry on the conversation, so no one makes a second one. Those the
  // viewer may not open (another team's, or Finance's) show only their
  // number, team and status: no subject, no link.
  enquiries: {
    id: string;
    number: string;
    subject: string | null;
    status: string;
    teamName: string;
    canOpen: boolean;
  }[];
  suggestedCategory: string | null;
};

export async function conversationDetail(
  viewer: Viewer,
  id: string,
): Promise<ConversationDetail | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [c] = await sql`
    SELECT c.*, u.full_name AS assignee_name,
           p.full_name, p.email, p.phone_e164, p.phone, p.preferred_language,
           p.needs_review
    FROM conversation c
    JOIN person p ON p.id = c.person_id
    LEFT JOIN app_user u ON u.id = c.assigned_user_id
    WHERE c.id = ${id} AND ${visible(viewer)}`;
  if (!c) {
    const [exists] = await sql`SELECT 1 FROM conversation WHERE id = ${id}`;
    if (exists)
      await writeAudit({
        userId: viewer.id,
        action: "permission_denied",
        entity: "conversation",
        entityId: id,
        before: null,
        after: null,
      });
    return null;
  }
  const [messages, enquiries] = await Promise.all([
    sql`
      SELECT m.id, m.direction, m.body, m.sent_at, m.status,
             cardinality(m.attachment_paths) AS attachments,
             u.full_name AS sender_name
      FROM conversation_message m
      LEFT JOIN app_user u ON u.id = m.sent_by_user_id
      WHERE m.conversation_id = ${id}
      ORDER BY m.sent_at, m.created_at`,
    // can_open: the same condition as the queue (lib/enquiries/access.ts).
    sql`
      SELECT e.id, e.number, e.subject, e.status, t.name AS team_name,
             (${enquiryAccessSql(sql, viewer, "read")}) AS can_open
      FROM enquiry e JOIN team t ON t.id = e.team_id
      WHERE e.conversation_id = ${id}
      ORDER BY e.created_at DESC`,
  ]);
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    assignedUserId: c.assigned_user_id,
    assigneeName: c.assignee_name,
    lastInboundAt: c.last_inbound_at,
    replyWindow: replyWindow(c.channel, c.last_inbound_at),
    person: {
      id: c.person_id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone_e164 ?? c.phone,
      preferredLanguage: c.preferred_language,
      needsReview: c.needs_review,
    },
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentAt: m.sent_at,
      status: m.status,
      senderName: m.sender_name,
      attachments: Number(m.attachments ?? 0),
    })),
    enquiries: enquiries.map((e) => ({
      id: e.id,
      number: e.number,
      subject: e.can_open ? e.subject : null,
      status: e.status,
      teamName: e.team_name,
      canOpen: e.can_open,
    })),
    suggestedCategory: lastIn?.body ? await suggestCategory(lastIn.body) : null,
  };
}

// ---- Changes ------------------------------------------------------------------

export type InboxWriteResult =
  { kind: "ok" } | { kind: "not_found" } | { kind: "invalid"; message: string };

// The conversation, locked, if the viewer may see it; otherwise not_found (the
// same answer as a missing one), with the refusal audited.
async function withConversation(
  viewer: Viewer,
  id: string,
  fn: (c: Record<string, unknown>) => Promise<InboxWriteResult>,
): Promise<InboxWriteResult> {
  if (!isUuid(id)) return { kind: "not_found" };
  let denied = false;
  const result = await withTransaction(async (): Promise<InboxWriteResult> => {
    const sql = db();
    const [c] = await sql`
      SELECT c.* FROM conversation c WHERE c.id = ${id} FOR UPDATE`;
    if (!c) return { kind: "not_found" };
    const [ok] = await sql`
      SELECT 1 FROM conversation c WHERE c.id = ${id} AND ${visible(viewer)}`;
    if (!ok) {
      denied = true;
      return { kind: "not_found" };
    }
    return fn(c);
  });
  if (denied)
    await writeAudit({
      userId: viewer.id,
      action: "permission_denied",
      entity: "conversation",
      entityId: id,
      before: null,
      after: null,
    });
  return result;
}

// Assign to anyone who may work the whole inbox (or nobody).
export async function assignConversation(
  viewer: Viewer,
  id: string,
  userId: string | null,
): Promise<InboxWriteResult> {
  return withConversation(viewer, id, async (c) => {
    const sql = db();
    if (userId !== null) {
      if (!isUuid(userId))
        return { kind: "invalid", message: "Pick someone from the list." };
      const [u] = await sql`
        SELECT role_code FROM app_user WHERE id = ${userId} AND is_active`;
      if (!u || !seesWholeInbox(u.role_code as Role))
        return {
          kind: "invalid",
          message:
            "Assign to an active support, sales, management or super admin user.",
        };
    }
    if (c.assigned_user_id === userId) return { kind: "ok" };
    await sql`
      UPDATE conversation SET assigned_user_id = ${userId} WHERE id = ${id}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "conversation",
      entityId: id,
      before: { assignedUserId: c.assigned_user_id },
      after: { assignedUserId: userId },
    });
    return { kind: "ok" };
  });
}

export async function setConversationStatus(
  viewer: Viewer,
  id: string,
  status: ConversationStatus,
): Promise<InboxWriteResult> {
  if (!CONVERSATION_STATUSES.includes(status))
    return { kind: "invalid", message: "Unknown status." };
  return withConversation(viewer, id, async (c) => {
    if (c.status === status) return { kind: "ok" };
    await db()`UPDATE conversation SET status = ${status} WHERE id = ${id}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "conversation",
      entityId: id,
      before: { status: c.status },
      after: { status },
    });
    return { kind: "ok" };
  });
}

// "Make enquiry": the agent picks the category; the team and assignee follow
// from it and the rules. The deadline counts from the customer's last
// message, not from when the agent clicked.
export async function enquiryFromConversation(
  viewer: Viewer,
  id: string,
  input: { category: string; subject: string },
): Promise<CreateResult | { kind: "not_found" }> {
  let found: Record<string, unknown> | null = null;
  const seen = await withConversation(viewer, id, async (c) => {
    found = c;
    return { kind: "ok" };
  });
  if (seen.kind !== "ok" || !found) return { kind: "not_found" };
  const c = found as {
    person_id: string;
    channel: ConversationChannel;
    last_inbound_at: Date | null;
  };
  return createEnquiry(
    {
      personId: c.person_id,
      conversationId: id,
      channel: c.channel,
      category: input.category,
      subject: input.subject,
      receivedAt: c.last_inbound_at ?? new Date(),
    },
    viewer,
  );
}

// Who a conversation can be assigned to.
export async function inboxAgents(): Promise<{ id: string; name: string }[]> {
  const rows = await db()`
    SELECT id, full_name FROM app_user
    WHERE is_active AND role_code IN ('super_admin','management','support','sales')
    ORDER BY full_name`;
  return rows.map((r) => ({ id: r.id as string, name: r.full_name as string }));
}
