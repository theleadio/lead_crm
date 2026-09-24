import {
  masksContactDetails,
  permissionFor,
  type Resource,
  type Viewer,
} from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { normalizeEmail } from "../format/email.ts";
import { maskEmail, maskPhone } from "../format/mask.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import type { PersonUpdate } from "../validation/person.ts";
import { findDuplicate } from "./dedupe.ts";
import { MOCK_OWNERS, MOCK_PEOPLE, type PersonRecord } from "./mock-data.ts";
import { mockRelated } from "./mock-related.ts";
import { isAssignedTo } from "./service.ts";
import type {
  ConsentState,
  ListResponse,
  PersonDetail,
  TimelineItem,
} from "./types.ts";

// Service layer for spec §9.2 Person detail (GET + PATCH /api/people/:id).
// Mock-backed; swap to Shawn's client when the schema lands.

const can = (viewer: Viewer, resource: Resource) =>
  permissionFor(viewer, resource, "read");

function canSeePerson(viewer: Viewer, p: PersonRecord): boolean {
  const { allowed, assignedOnly } = can(viewer, "person");
  return allowed && (!assignedOnly || isAssignedTo(p, viewer.id));
}

function toDetailPerson(
  p: PersonRecord,
  viewer: Viewer,
): PersonDetail["person"] {
  const masked = masksContactDetails(viewer.role);
  return {
    id: p.id,
    fullName: p.fullName,
    preferredName: p.preferredName,
    email: masked ? maskEmail(p.email) : p.email,
    phone: masked ? maskPhone(p.phoneE164 ?? p.phone) : p.phone,
    whatsapp: masked ? maskPhone(p.whatsappE164) : p.whatsappE164,
    preferredLanguage: p.preferredLanguage,
    jobTitle: p.jobTitle,
    notes: p.notes,
    stage: p.stage,
    owner: p.owner,
    companyName: p.companyName,
    needsReview: p.needsReview,
    needsReviewReason: p.needsReviewReason,
    lastActivityAt: p.lastActivityAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export type DetailResult =
  | { kind: "ok"; detail: PersonDetail }
  | { kind: "not_found" }
  | { kind: "forbidden" };

export async function getPersonDetail(
  id: string,
  viewer: Viewer,
): Promise<DetailResult> {
  const p = MOCK_PEOPLE.find((x) => x.id === id);
  if (!p) return { kind: "not_found" };
  if (!canSeePerson(viewer, p)) return { kind: "forbidden" };

  const r = mockRelated(p);
  // part_time "A" on enquiries means assigned-only (§6 v1.2). Mock: the
  // enquiry is assigned to the people in assignedUserIds.
  const readable = (res: Resource) => {
    const { allowed, assignedOnly } = can(viewer, res);
    return allowed && !assignedOnly;
  };

  let payments: PersonDetail["payments"] = null;
  if (can(viewer, "payment").allowed) {
    // §6 footnote ²: sales sees payments only on deals they own.
    const visible =
      viewer.role === "sales"
        ? r.payments.filter((x) => x.dealOwnerId === viewer.id)
        : r.payments;
    payments = visible.map((x) => ({
      id: x.id,
      method: x.method,
      amountMyr: x.amountMyr,
      paidAt: x.paidAt,
      status: x.status,
    }));
    // §6: every view of a payment record is audit-logged.
    for (const pay of payments)
      await writeAudit({
        userId: viewer.id,
        action: "view",
        entity: "payment",
        entityId: pay.id,
        before: null,
        after: null,
      });
  }

  const touches = [...r.touchpoints].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );

  return {
    kind: "ok",
    detail: {
      person: toDetailPerson(p, viewer),
      attribution: {
        firstTouch: touches[0] ?? null,
        latestTouch: touches.length > 1 ? touches[touches.length - 1] : null,
      },
      deals: can(viewer, "deal").allowed
        ? r.deals.map((d) => ({
            id: d.id,
            stage: d.stage,
            courseName: d.courseName,
            amountMyr: d.amountMyr,
            owner: d.owner,
          }))
        : null,
      enrolments: can(viewer, "enrolment").allowed ? r.enrolments : null,
      payments,
      enquiries: can(viewer, "enquiry").allowed
        ? readable("enquiry") || p.assignedUserIds.includes(viewer.id)
          ? r.enquiries
          : []
        : null,
    },
  };
}

type Found = { kind: "not_found" } | { kind: "forbidden" };

function findVisible(
  id: string,
  viewer: Viewer,
): { kind: "ok"; person: PersonRecord } | Found {
  const person = MOCK_PEOPLE.find((x) => x.id === id);
  if (!person) return { kind: "not_found" };
  if (!canSeePerson(viewer, person)) return { kind: "forbidden" };
  return { kind: "ok", person };
}

// GET /api/people/:id/timeline — spec §7.1: newest first, 50 per page.
// Items the viewer's role can't read are left out (§6).
export async function getPersonTimeline(
  id: string,
  viewer: Viewer,
  page: number,
  limit = 50,
): Promise<{ kind: "ok"; result: ListResponse<TimelineItem> } | Found> {
  const found = findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const { person } = found;

  const readable = (res: Resource) => {
    const { allowed, assignedOnly } = can(viewer, res);
    return allowed && !assignedOnly;
  };
  const payOk = can(viewer, "payment").allowed;
  const allowed = mockRelated(person).timeline.filter((t) => {
    if (t.resource === "person") return true;
    if (t.resource === "deal") return can(viewer, "deal").allowed;
    if (t.resource === "task") return readable("task");
    if (t.resource === "enrolment") return can(viewer, "enrolment").allowed;
    // Sales sees payments only on deals they own (§6 ²) — mock ties the
    // payment's deal owner to the person's owner.
    return payOk && (viewer.role !== "sales" || person.owner?.id === viewer.id);
  });

  const start = (page - 1) * limit;
  const items = allowed.slice(start, start + limit);

  // §6: every view of a payment record is audit-logged.
  for (const t of items)
    if (t.resource === "payment")
      await writeAudit({
        userId: viewer.id,
        action: "view",
        entity: "payment",
        entityId: t.recordId,
        before: null,
        after: null,
      });

  return {
    kind: "ok",
    result: {
      data: items.map((t) => ({ at: t.at, kind: t.kind, text: t.text })),
      page: { total: allowed.length, page, limit },
    },
  };
}

// GET /api/consent/:personId — spec §7. Latest row per purpose wins (§5).
export async function getPersonConsent(
  id: string,
  viewer: Viewer,
): Promise<{ kind: "ok"; consent: ConsentState[] } | Found> {
  if (!can(viewer, "consent").allowed) return { kind: "forbidden" };
  const found = findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  return { kind: "ok", consent: mockRelated(found.person).consent };
}

export type UpdateResult =
  | { kind: "updated"; person: PersonDetail["person"] }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "stale" }
  | { kind: "invalid"; fields: Record<string, string> }
  | {
      kind: "duplicate";
      on: "email" | "phone";
      existing: { id: string; fullName: string };
    };

const blankToNull = (s: string) => (s === "" ? null : s);

// Spec §7 concurrency: the client sends the updated_at it loaded
// (If-Unmodified-Since). Anything else means someone saved in between.
export async function updatePerson(
  id: string,
  patch: PersonUpdate,
  loadedUpdatedAt: string,
  viewer: Viewer,
): Promise<UpdateResult> {
  const p = MOCK_PEOPLE.find((x) => x.id === id);
  if (!p) return { kind: "not_found" };
  const { allowed } = permissionFor(viewer, "person", "write");
  if (!allowed || !canSeePerson(viewer, p)) return { kind: "forbidden" };
  if (loadedUpdatedAt !== p.updatedAt) return { kind: "stale" };

  const next: PersonRecord = { ...p };
  const fields: Record<string, string> = {};

  if (patch.fullName !== undefined) next.fullName = patch.fullName;
  if (patch.preferredName !== undefined)
    next.preferredName = blankToNull(patch.preferredName);
  if (patch.preferredLanguage !== undefined)
    next.preferredLanguage = patch.preferredLanguage;
  if (patch.jobTitle !== undefined) next.jobTitle = blankToNull(patch.jobTitle);
  if (patch.notes !== undefined) next.notes = blankToNull(patch.notes);

  if (patch.email !== undefined) {
    next.email = blankToNull(patch.email);
    next.emailNorm = next.email ? normalizeEmail(next.email) : null;
  }

  if (patch.phone !== undefined) {
    next.phone = blankToNull(patch.phone);
    next.phoneE164 = next.phone ? normalizePhoneE164(next.phone) : null;
    // §4: an unnormalisable phone is kept and flagged, never dropped.
    const badPhone = "Phone number could not be normalised";
    if (next.phone && !next.phoneE164) {
      next.needsReview = true;
      next.needsReviewReason = badPhone;
    } else if (p.needsReviewReason === badPhone) {
      next.needsReview = false;
      next.needsReviewReason = null;
    }
  }

  if (patch.whatsapp !== undefined) {
    // whatsapp_e164 has no "as typed" column, so it must normalise.
    const e164 = patch.whatsapp ? normalizePhoneE164(patch.whatsapp) : null;
    if (patch.whatsapp && !e164)
      fields.whatsapp = "Enter a Malaysian mobile number";
    else next.whatsappE164 = e164;
  }

  if (patch.ownerId !== undefined) {
    const owner = patch.ownerId
      ? MOCK_OWNERS.find((o) => o.id === patch.ownerId)
      : null;
    if (patch.ownerId && !owner) fields.ownerId = "That owner doesn't exist";
    else next.owner = owner ?? null;
  }

  if (Object.keys(fields).length) return { kind: "invalid", fields };

  // §9.2: saving a phone or email that belongs to someone else → 409.
  const dup = findDuplicate(
    {
      fullName: next.fullName,
      emailNorm: next.emailNorm !== p.emailNorm ? next.emailNorm : null,
      phoneE164: next.phoneE164 !== p.phoneE164 ? next.phoneE164 : null,
      companyName: null,
    },
    MOCK_PEOPLE.filter((x) => x.id !== p.id),
  );
  if (dup.kind === "hard")
    return {
      kind: "duplicate",
      on: dup.on,
      existing: { id: dup.match.id, fullName: dup.match.fullName },
    };

  // Keep updated_at strictly increasing so a stale check can't pass by luck.
  const now = Math.max(Date.now(), Date.parse(p.updatedAt) + 1);
  next.updatedAt = new Date(now).toISOString();
  // §12.9: editing a field never touches last_activity_at.

  const changed = (Object.keys(next) as (keyof PersonRecord)[]).filter(
    (k) =>
      k !== "updatedAt" && JSON.stringify(next[k]) !== JSON.stringify(p[k]),
  );
  await writeAudit({
    userId: viewer.id,
    action: "update",
    entity: "person",
    entityId: p.id,
    before: Object.fromEntries(changed.map((k) => [k, p[k]])),
    after: Object.fromEntries(changed.map((k) => [k, next[k]])),
  });

  Object.assign(p, next);
  return { kind: "updated", person: toDetailPerson(p, viewer) };
}

// GET /api/people/:id/data-export — spec §7.1 / §14 PDPA portability.
// super_admin only (done on the person's request); audit-logged. Unmasked:
// this is the person's own data going back to them.
export async function exportPersonData(
  id: string,
  viewer: Viewer,
  format: "json" | "csv",
): Promise<{ kind: "ok"; data: Record<string, unknown> } | Found> {
  if (viewer.role !== "super_admin") return { kind: "forbidden" };
  const found = findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const p = found.person;
  const r = mockRelated(p);

  const data = {
    person: {
      id: p.id,
      fullName: p.fullName,
      preferredName: p.preferredName,
      email: p.email,
      phone: p.phone,
      whatsapp: p.whatsappE164,
      preferredLanguage: p.preferredLanguage,
      jobTitle: p.jobTitle,
      notes: p.notes,
      company: p.companyName,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    },
    touchpoints: r.touchpoints,
    deals: r.deals,
    enrolments: r.enrolments,
    payments: r.payments.map((x) => ({
      id: x.id,
      method: x.method,
      amountMyr: x.amountMyr,
      paidAt: x.paidAt,
      status: x.status,
    })),
    enquiries: r.enquiries,
    consent: r.consent,
  };

  await writeAudit({
    userId: viewer.id,
    action: "export",
    entity: "person",
    entityId: p.id,
    before: null,
    after: { kind: "pdpa_data_export", format },
  });
  return { kind: "ok", data };
}

// CSV version: one row per value — section, record, field, value.
export function personDataToRows(data: Record<string, unknown>): string[][] {
  const rows: string[][] = [];
  for (const [section, value] of Object.entries(data)) {
    const records = Array.isArray(value) ? value : [value];
    records.forEach((rec, i) => {
      for (const [field, v] of Object.entries(rec as Record<string, unknown>))
        rows.push([section, String(i + 1), field, v == null ? "" : String(v)]);
    });
  }
  return rows;
}
