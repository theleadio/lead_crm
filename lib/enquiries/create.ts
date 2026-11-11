import { writeAudit } from "../audit.ts";
import type { Role, Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { teamsOf } from "./access.ts";
import { replyDueAt, type Holidays } from "./deadline.ts";
import {
  enquiryEvent,
  isActiveMember,
  loadHolidays,
  nextInTeam,
  noteAssigned,
  route,
  UnknownCategory,
} from "./routing.ts";
import type { EnquiryPriority } from "./types.ts";

// Making an enquiry: by hand (a call, a walk-in), from an inbox conversation,
// from the website help form, or as a follow-up to a closed one. Routing and
// the deadline are lib/enquiries/routing.ts and deadline.ts.

// Who may make one by hand or from the inbox: the roles that work the inbox,
// and any team member (from the ticket design, §6 there).
const MAY_CREATE: readonly Role[] = [
  "super_admin",
  "management",
  "support",
  "sales",
];

export async function mayCreateEnquiries(viewer: Viewer): Promise<boolean> {
  return (
    MAY_CREATE.includes(viewer.role) || (await teamsOf(viewer.id)).length > 0
  );
}

export type NewEnquiry = {
  personId: string;
  conversationId?: string | null;
  // web_form, whatsapp, email, messenger, instagram, walk_in, phone…
  channel: string;
  category: string;
  subject: string;
  priority?: EnquiryPriority;
  note?: string | null;
  previousEnquiryId?: string | null;
  // When the customer asked; the deadline counts from here. Defaults to now.
  receivedAt?: Date;
};

export type CreatedEnquiry = {
  id: string;
  number: string;
  teamId: string;
  assignedUserId: string | null;
  slaDueAt: Date;
};

export type CreateResult =
  | { kind: "ok"; enquiry: CreatedEnquiry }
  | { kind: "forbidden" }
  | { kind: "invalid"; field: string; message: string };

// `viewer` is null when the system makes it (the help form, a follow-up).
export async function createEnquiry(
  input: NewEnquiry,
  viewer: Viewer | null,
  holidays?: Holidays,
): Promise<CreateResult> {
  const subject = input.subject.trim().slice(0, 200);
  if (!subject)
    return { kind: "invalid", field: "subject", message: "Add a subject" };
  if (!isUuid(input.personId))
    return { kind: "invalid", field: "personId", message: "Pick a person" };
  if (viewer && !(await mayCreateEnquiries(viewer)))
    return { kind: "forbidden" };
  const receivedAt = input.receivedAt ?? new Date();
  const due = replyDueAt(receivedAt, holidays ?? (await loadHolidays()));

  return withTransaction(async (): Promise<CreateResult> => {
    const sql = db();
    const [p] = await sql`
      SELECT 1 FROM person
      WHERE id = ${input.personId} AND deleted_at IS NULL AND merged_into_id IS NULL`;
    if (!p)
      return { kind: "invalid", field: "personId", message: "Pick a person" };
    let r;
    try {
      r = await route(input.category, input.channel);
    } catch (e) {
      if (e instanceof UnknownCategory)
        return {
          kind: "invalid",
          field: "category",
          message: "Pick a category from the list",
        };
      throw e;
    }
    const assignee =
      r.mode === "none"
        ? null
        : r.mode === "fixed" &&
            r.userId &&
            (await isActiveMember(r.teamId, r.userId))
          ? r.userId
          : await nextInTeam(r.teamId);
    const [e] = await sql`
      INSERT INTO enquiry (created_by, person_id, conversation_id, channel,
        category, team_id, assigned_user_id, priority, subject, sla_due_at,
        first_message_at, previous_enquiry_id)
      VALUES (${viewer?.id ?? null}, ${input.personId},
        ${input.conversationId ?? null}, ${input.channel}, ${input.category},
        ${r.teamId}, ${assignee}, ${input.priority ?? "normal"}, ${subject},
        ${due}, ${receivedAt}, ${input.previousEnquiryId ?? null})
      RETURNING id, number, team_id, assigned_user_id, sla_due_at`;
    await noteAssigned(r.teamId, assignee);
    // No subject or note here: audit_log and the event's before/after can
    // never be erased (#48 review).
    const after = {
      number: e.number,
      channel: input.channel,
      category: input.category,
      teamId: r.teamId,
      assignedUserId: assignee,
      slaDueAt: due.toISOString(),
      previousEnquiryId: input.previousEnquiryId ?? null,
    };
    await enquiryEvent(
      e.id,
      viewer?.id ?? null,
      "created",
      null,
      after,
      input.note?.trim() || null,
    );
    await writeAudit({
      userId: viewer?.id ?? null,
      action: "create",
      entity: "enquiry",
      entityId: e.id,
      before: null,
      after,
    });
    return {
      kind: "ok",
      enquiry: {
        id: e.id as string,
        number: e.number as string,
        teamId: e.team_id as string,
        assignedUserId: (e.assigned_user_id as string | null) ?? null,
        slaDueAt: e.sla_due_at as Date,
      },
    };
  });
}

// The customer wrote again about an enquiry that is already resolved or
// closed: a new enquiry, linked to the old one, same person, category and
// conversation (decided 4 Nov for tickets). The old one stays as it is, since
// closing is final (§9.13).
export async function followUpEnquiry(
  previousId: string,
  receivedAt: Date,
  holidays?: Holidays,
): Promise<CreateResult> {
  if (!isUuid(previousId))
    return { kind: "invalid", field: "previousId", message: "No such enquiry" };
  const [prev] = await db()`
    SELECT id, number, person_id, conversation_id, channel, category, subject,
           status
    FROM enquiry WHERE id = ${previousId}`;
  if (!prev)
    return { kind: "invalid", field: "previousId", message: "No such enquiry" };
  if (prev.status === "open" || prev.status === "waiting_customer")
    return {
      kind: "invalid",
      field: "previousId",
      message: "That enquiry is still open",
    };
  // A category switched off since falls back to `other`, which stays on.
  const [active] = prev.category
    ? await db()`
        SELECT 1 FROM enquiry_category WHERE code = ${prev.category} AND active`
    : [];
  return createEnquiry(
    {
      personId: prev.person_id,
      conversationId: prev.conversation_id,
      channel: prev.channel,
      category: active ? prev.category : "other",
      subject: prev.subject
        ? `Re: ${prev.subject}`.slice(0, 200)
        : `Follows ${prev.number}`,
      previousEnquiryId: previousId,
      note: `Follows ${prev.number}.`,
      receivedAt,
    },
    null,
    holidays,
  );
}
