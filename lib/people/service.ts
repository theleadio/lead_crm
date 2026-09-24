import { randomUUID } from "node:crypto";
import {
  masksContactDetails,
  permissionFor,
  type Viewer,
} from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { normalizeEmail } from "../format/email.ts";
import { maskEmail, maskPhone } from "../format/mask.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import type { PersonInput } from "../validation/person.ts";
import { findDuplicate, SOFT_REASON_TEXT } from "./dedupe.ts";
import {
  MOCK_OWNERS,
  MOCK_PEOPLE,
  MOCK_TAGS,
  type PersonRecord,
} from "./mock-data.ts";
import { matchesPersonQuery } from "./search.ts";
import type {
  ListResponse,
  OwnerOption,
  TagOption,
  PeopleFilters,
  PeopleListQuery,
  PersonListItem,
} from "./types.ts";

// Service layer (spec §3 layering rule): the only code that touches data.
// Reads/writes mock data today; swap to Shawn's generated client when it
// lands — API routes and screens don't change.

// Spec §6 (v1.2): a part-timer sees people they own, or who have an
// enquiry or task assigned to them.
export const isAssignedTo = (p: PersonRecord, userId: string) =>
  p.owner?.id === userId || p.assignedUserIds.includes(userId);

// Asia/Kuala_Lumpur is UTC+8 with no DST.
const klStartOfDay = (d: string) => Date.parse(`${d}T00:00:00+08:00`);
const klEndOfDay = (d: string) => Date.parse(`${d}T23:59:59.999+08:00`);

function visibleTo(viewer: Viewer, filters: PeopleFilters): PersonRecord[] {
  // part_time "assigned only": real version is a WHERE clause (spec §6).
  const { assignedOnly } = permissionFor(viewer, "person", "read");
  return MOCK_PEOPLE.filter((p) => {
    if (assignedOnly && !isAssignedTo(p, viewer.id)) return false;
    if (filters.q && !matchesPersonQuery(p, filters.q)) return false;
    if (filters.stage && p.stage !== filters.stage) return false;
    if (filters.language && p.preferredLanguage !== filters.language)
      return false;
    if (
      filters.needsReview !== undefined &&
      p.needsReview !== filters.needsReview
    )
      return false;
    if (filters.owner === "unassigned" && p.owner) return false;
    if (
      filters.owner &&
      filters.owner !== "unassigned" &&
      p.owner?.id !== filters.owner
    )
      return false;
    // filters.tags holds tag ids; mock people store tag names.
    if (
      filters.tags?.length &&
      !filters.tags.some((id) => p.tags.includes(tagName(id) ?? ""))
    )
      return false;
    if (
      filters.hasOpenDeal !== undefined &&
      p.hasOpenDeal !== filters.hasOpenDeal
    )
      return false;
    const created = Date.parse(p.createdAt);
    if (filters.createdFrom && created < klStartOfDay(filters.createdFrom))
      return false;
    if (filters.createdTo && created > klEndOfDay(filters.createdTo))
      return false;
    return true;
  });
}

// Spec §7: lists never return more than they must. Spec §6 footnote ¹:
// marketing gets masked strings — real values never leave the server.
function toListItem(p: PersonRecord, viewer: Viewer): PersonListItem {
  const masked = masksContactDetails(viewer.role);
  return {
    id: p.id,
    fullName: p.fullName,
    preferredName: p.preferredName,
    email: masked ? maskEmail(p.email) : p.email,
    phone: masked ? maskPhone(p.phoneE164 ?? p.phone) : p.phone,
    phoneE164: masked ? null : p.phoneE164,
    preferredLanguage: p.preferredLanguage,
    stage: p.stage,
    owner: p.owner,
    lastActivityAt: p.lastActivityAt,
    tags: p.tags,
    needsReview: p.needsReview,
    needsReviewReason: p.needsReviewReason,
    createdAt: p.createdAt,
  };
}

export async function listPeople(
  query: PeopleListQuery,
  viewer: Viewer,
): Promise<ListResponse<PersonListItem>> {
  const filtered = visibleTo(viewer, query);
  const start = (query.page - 1) * query.limit;
  return {
    data: filtered
      .slice(start, start + query.limit)
      .map((p) => toListItem(p, viewer)),
    page: { total: filtered.length, page: query.page, limit: query.limit },
  };
}

// Export CSV: all matching rows, not just the current page. Audit-logged.
export async function exportPeople(
  filters: PeopleFilters,
  viewer: Viewer,
): Promise<PersonListItem[]> {
  const rows = visibleTo(viewer, filters).map((p) => toListItem(p, viewer));
  await writeAudit({
    userId: viewer.id,
    action: "export",
    entity: "person",
    entityId: null,
    before: null,
    after: { filters, rowCount: rows.length },
  });
  return rows;
}

export type CreatePersonResult =
  | { kind: "created"; person: PersonListItem }
  | {
      kind: "duplicate";
      on: "email" | "phone";
      existing: { id: string; fullName: string };
    };

const blankToNull = (s: string | undefined) => (s ? s : null);

export async function createPerson(
  input: PersonInput,
  viewer: Viewer,
): Promise<CreatePersonResult> {
  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  const emailNorm = email ? normalizeEmail(email) : null;
  const phoneE164 = phone ? normalizePhoneE164(phone) : null;

  // Spec §12.2 runs on every person create, from any route.
  const dup = findDuplicate(
    { fullName: input.fullName, emailNorm, phoneE164, companyName: null },
    MOCK_PEOPLE,
  );
  if (dup.kind === "hard") {
    return {
      kind: "duplicate",
      on: dup.on,
      existing: { id: dup.match.id, fullName: dup.match.fullName },
    };
  }

  // Spec §4: an unnormalisable phone is kept and flagged, never dropped.
  const reviewReason =
    phone && !phoneE164
      ? "Phone number could not be normalised"
      : dup.kind === "soft"
        ? SOFT_REASON_TEXT[dup.on]
        : null;

  const now = new Date().toISOString();
  const record: PersonRecord = {
    id: randomUUID(),
    fullName: input.fullName,
    preferredName: blankToNull(input.preferredName),
    email,
    emailNorm,
    phone,
    phoneE164,
    whatsappE164: phoneE164,
    preferredLanguage: input.preferredLanguage,
    jobTitle: blankToNull(input.jobTitle),
    notes: blankToNull(input.notes),
    stage: "lead",
    owner: null,
    lastActivityAt: null, // spec §12.9: a manual create is not an activity
    tags: [],
    needsReview: reviewReason !== null,
    needsReviewReason: reviewReason,
    companyName: null,
    hasOpenDeal: false,
    assignedUserIds: [],
    createdAt: now,
    updatedAt: now,
  };
  MOCK_PEOPLE.unshift(record);

  await writeAudit({
    userId: viewer.id,
    action: "create",
    entity: "person",
    entityId: record.id,
    before: null,
    after: record,
  });

  return { kind: "created", person: toListItem(record, viewer) };
}

export type BulkChange =
  | { kind: "assignOwner"; ownerId: string | null }
  | { kind: "addTag"; tagId: string };

export class InvalidBulkChange extends Error {}

export async function bulkUpdatePeople(
  ids: string[],
  change: BulkChange,
  viewer: Viewer,
): Promise<{ updated: number }> {
  const owner =
    change.kind === "assignOwner" && change.ownerId
      ? MOCK_OWNERS.find((o) => o.id === change.ownerId)
      : null;
  if (change.kind === "assignOwner" && change.ownerId && !owner)
    throw new InvalidBulkChange("That owner doesn't exist.");
  const tag = change.kind === "addTag" ? tagName(change.tagId) : null;
  if (change.kind === "addTag" && !tag)
    throw new InvalidBulkChange("That tag doesn't exist.");

  // Only records this viewer can see (part_time: their own) are touched.
  const targets = visibleTo(viewer, {}).filter((p) => ids.includes(p.id));
  const now = new Date().toISOString();

  for (const p of targets) {
    const before = { owner: p.owner, tags: p.tags };
    if (change.kind === "assignOwner") p.owner = owner ?? null;
    else if (tag && !p.tags.includes(tag)) p.tags = [...p.tags, tag];
    p.updatedAt = now;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "person",
      entityId: p.id,
      before,
      after: { owner: p.owner, tags: p.tags },
    });
  }
  return { updated: targets.length };
}

// §7.1: {id, fullName} of active users, nothing else.
export async function listOwnerOptions(): Promise<OwnerOption[]> {
  return MOCK_OWNERS.map((o) => ({ id: o.id, fullName: o.fullName }));
}

export async function listTagOptions(): Promise<TagOption[]> {
  return MOCK_TAGS.map((t) => ({ id: t.id, name: t.name }));
}

const tagName = (id: string) =>
  MOCK_TAGS.find((t) => t.id === id)?.name ?? null;
