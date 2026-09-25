import type postgres from "postgres";
import {
  masksContactDetails,
  permissionFor,
  type Resource,
  type Viewer,
} from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { normalizeEmail } from "../format/email.ts";
import { maskEmail, maskPhone } from "../format/mask.ts";
import { formatMoneyMyr } from "../format/money.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { db, withTransaction } from "../sql.ts";
import type { PersonUpdate } from "../validation/person.ts";
import { findDuplicate } from "./dedupe.ts";
import { stageSql } from "./lifecycle.ts";
import {
  dedupeCandidates,
  isUuid,
  reviewReason,
  visibleSql,
} from "./service.ts";
import type {
  ConsentState,
  ListResponse,
  PersonDetail,
  TimelineItem,
  Touchpoint,
} from "./types.ts";

// Service layer for spec §9.2 Person detail and its §7/§7.1 routes.

const can = (viewer: Viewer, resource: Resource) =>
  permissionFor(viewer, resource, "read");

type Found = { kind: "not_found" } | { kind: "forbidden" };

type PersonRow = {
  id: string;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  preferred_language: "en" | "zh";
  job_title: string | null;
  notes: string | null;
  needs_review: boolean;
  needs_review_reason: string | null;
  last_activity_at: Date | null;
  created_at: Date;
  updated_at: string; // full microsecond precision, see selectPerson
  owner_id: string | null;
  owner_name: string | null;
  company_id: string | null;
  company_name: string | null;
  company_name_given: string | null;
  stage: "lead" | "student" | "customer";
};

function selectPerson(sql: postgres.Sql) {
  // updated_at as text with microseconds: the stale-edit check (spec §7)
  // compares it exactly, and a JS Date would drop the microseconds.
  return sql`
    SELECT p.id, p.full_name, p.preferred_name, p.email, p.phone, p.phone_e164,
           p.whatsapp_e164, p.preferred_language, p.job_title, p.notes,
           p.needs_review, p.needs_review_reason, p.last_activity_at, p.created_at,
           to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
           u.id AS owner_id, u.full_name AS owner_name,
           cur.company_id, cur.company_name, p.company_name_given,
           ${stageSql(sql)} AS stage
    FROM person p LEFT JOIN app_user u ON u.id = p.owner_user_id
    LEFT JOIN LATERAL (
      SELECT co.id AS company_id, co.legal_name AS company_name
      FROM company_membership m JOIN company co ON co.id = m.company_id
      WHERE m.person_id = p.id AND m.end_date IS NULL AND co.deleted_at IS NULL
      ORDER BY m.created_at LIMIT 1) cur ON true`;
}

// Loads a person the viewer may see; tells "missing" apart from "not yours".
async function findVisible(
  id: string,
  viewer: Viewer,
): Promise<{ kind: "ok"; person: PersonRow } | Found> {
  if (!isUuid(id)) return { kind: "not_found" };
  const sql = db();
  const [person] = await sql<PersonRow[]>`
    ${selectPerson(sql)} WHERE p.id = ${id} AND ${visibleSql(sql, viewer)}`;
  if (person) return { kind: "ok", person };
  const [exists] = await sql`
    SELECT 1 FROM person p WHERE p.id = ${id}
    AND p.deleted_at IS NULL AND p.merged_into_id IS NULL`;
  return exists ? { kind: "forbidden" } : { kind: "not_found" };
}

function toDetailPerson(p: PersonRow, viewer: Viewer): PersonDetail["person"] {
  const masked = masksContactDetails(viewer.role);
  return {
    id: p.id,
    fullName: p.full_name,
    preferredName: p.preferred_name,
    email: masked ? maskEmail(p.email) : p.email,
    phone: masked ? maskPhone(p.phone_e164 ?? p.phone) : p.phone,
    whatsapp: masked ? maskPhone(p.whatsapp_e164) : p.whatsapp_e164,
    preferredLanguage: p.preferred_language,
    jobTitle: p.job_title,
    notes: p.notes,
    stage: p.stage,
    owner: p.owner_id ? { id: p.owner_id, fullName: p.owner_name ?? "" } : null,
    companyId: p.company_id,
    companyName: p.company_name,
    companyNameGiven: p.company_name_given,
    needsReview: p.needs_review,
    needsReviewReason: reviewReason(p),
    lastActivityAt: p.last_activity_at?.toISOString() ?? null,
    createdAt: p.created_at.toISOString(),
    version: p.updated_at,
  };
}

// Payments tied to the person through their enrolments or deals, with the
// owning deal's owner — sales sees only payments on deals they own (§6 ²).
function paymentsSql(sql: postgres.Sql, personId: string, viewer: Viewer) {
  return sql`
    SELECT pay.id, pay.method, pay.amount_myr, pay.paid_at, pay.status, pay.created_at
    FROM payment pay
    LEFT JOIN enrolment e ON e.id = pay.enrolment_id
    LEFT JOIN deal d ON d.id = coalesce(pay.deal_id, e.deal_id)
    WHERE (e.person_id = ${personId} OR d.person_id = ${personId})
      ${viewer.role === "sales" ? sql`AND d.owner_user_id = ${viewer.id}` : sql``}`;
}

async function auditPaymentViews(viewer: Viewer, ids: string[]) {
  // §6: every view of a payment record is audit-logged.
  for (const id of ids)
    await writeAudit({
      userId: viewer.id,
      action: "view",
      entity: "payment",
      entityId: id,
      before: null,
      after: null,
    });
}

export type DetailResult = { kind: "ok"; detail: PersonDetail } | Found;

export async function getPersonDetail(
  id: string,
  viewer: Viewer,
): Promise<DetailResult> {
  const found = await findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const p = found.person;
  const sql = db();

  const touches = await sql`
    SELECT id, occurred_at, channel, utm_source, utm_campaign, is_first_touch
    FROM touchpoint WHERE person_id = ${p.id} ORDER BY occurred_at`;
  const toTouch = (t: (typeof touches)[number]): Touchpoint => ({
    id: t.id,
    occurredAt: t.occurred_at.toISOString(),
    channel: t.channel,
    utmSource: t.utm_source,
    utmCampaign: t.utm_campaign,
  });
  const first = touches.find((t) => t.is_first_touch) ?? touches[0];
  const latest = touches.at(-1);

  const deals = can(viewer, "deal").allowed
    ? (
        await sql`
          SELECT d.id, d.stage, d.amount_myr, c.name_en AS course_name, u.full_name AS owner_name
          FROM deal d
          LEFT JOIN course c ON c.id = d.course_id
          LEFT JOIN app_user u ON u.id = d.owner_user_id
          WHERE d.person_id = ${p.id} AND d.deleted_at IS NULL
          ORDER BY d.created_at DESC`
      ).map((d) => ({
        id: d.id,
        stage: d.stage,
        courseName: d.course_name ?? "No course",
        amountMyr: d.amount_myr ?? "0.00",
        owner: d.owner_name,
      }))
    : null;

  const enrolments = can(viewer, "enrolment").allowed
    ? (
        await sql`
          SELECT e.id, cl.code AS class_code, e.status, e.price_paid_myr
          FROM enrolment e JOIN class cl ON cl.id = e.class_id
          WHERE e.person_id = ${p.id} ORDER BY e.created_at DESC`
      ).map((e) => ({
        id: e.id,
        classCode: e.class_code,
        status: e.status,
        pricePaidMyr: e.price_paid_myr,
      }))
    : null;

  let payments: PersonDetail["payments"] = null;
  if (can(viewer, "payment").allowed) {
    const rows =
      await sql`${paymentsSql(sql, p.id, viewer)} ORDER BY pay.created_at DESC`;
    payments = rows.map((x) => ({
      id: x.id,
      method: x.method,
      amountMyr: x.amount_myr,
      paidAt: x.paid_at?.toISOString() ?? null,
      status: x.status,
    }));
    await auditPaymentViews(
      viewer,
      payments.map((x) => x.id),
    );
  }

  // part_time "A" on enquiries = only ones assigned to them (§6 v1.2).
  const enquiryAccess = can(viewer, "enquiry");
  const enquiries = enquiryAccess.allowed
    ? (
        await sql`
          SELECT id, channel, category, status, handled_by FROM enquiry
          WHERE person_id = ${p.id}
            ${enquiryAccess.assignedOnly ? sql`AND assigned_user_id = ${viewer.id}` : sql``}
          ORDER BY created_at DESC`
      ).map((q) => ({
        id: q.id,
        channel: q.channel,
        category: q.category ?? "other",
        status: q.status,
        handledBy: q.handled_by ?? "user",
      }))
    : null;

  return {
    kind: "ok",
    detail: {
      person: toDetailPerson(p, viewer),
      attribution: {
        firstTouch: first ? toTouch(first) : null,
        latestTouch: latest && latest.id !== first?.id ? toTouch(latest) : null,
      },
      deals,
      enrolments,
      payments,
      enquiries,
    },
  };
}

// GET /api/people/:id/timeline — spec §7.1: touchpoints, stage changes,
// tasks, messages, payments, enrolment changes; newest first, 50 per page.
// Branches the viewer's role can't read are left out of the query (§6).
export async function getPersonTimeline(
  id: string,
  viewer: Viewer,
  page: number,
  limit = 50,
): Promise<{ kind: "ok"; result: ListResponse<TimelineItem> } | Found> {
  const found = await findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const pid = found.person.id;
  const sql = db();

  const task = can(viewer, "task");
  const branches = [
    sql`SELECT occurred_at AS at, 'touchpoint' AS kind, channel AS a, utm_source AS b,
               NULL::numeric AS amount, NULL::uuid AS record_id
        FROM touchpoint WHERE person_id = ${pid}`,
    sql`SELECT coalesce(sent_at, created_at), 'message', channel, direction, NULL, id
        FROM message_log WHERE person_id = ${pid}`,
  ];
  if (can(viewer, "deal").allowed)
    branches.push(sql`
      SELECT h.changed_at, 'stage_change', coalesce(c.name_en, 'a deal'), h.to_stage, NULL, d.id
      FROM deal_stage_history h JOIN deal d ON d.id = h.deal_id
      LEFT JOIN course c ON c.id = d.course_id
      WHERE d.person_id = ${pid} AND d.deleted_at IS NULL`);
  if (task.allowed)
    branches.push(sql`
      SELECT coalesce(done_at, created_at), 'task', title,
             CASE WHEN done_at IS NULL THEN 'created' ELSE 'done' END, NULL, id
      FROM task WHERE person_id = ${pid}
        ${task.assignedOnly ? sql`AND assigned_user_id = ${viewer.id}` : sql``}`);
  if (can(viewer, "enrolment").allowed)
    branches.push(sql`
      SELECT e.updated_at, 'enrolment_change', cl.code, e.status, NULL, e.id
      FROM enrolment e JOIN class cl ON cl.id = e.class_id WHERE e.person_id = ${pid}`);
  if (can(viewer, "payment").allowed)
    branches.push(sql`
      SELECT coalesce(x.paid_at, x.created_at), 'payment', x.method, x.status, x.amount_myr, x.id
      FROM (${paymentsSql(sql, pid, viewer)}) x`);

  const union = branches.reduce((acc, b) => sql`${acc} UNION ALL ${b}`);
  const [{ total }] =
    await sql`SELECT count(*)::int AS total FROM (${union}) t`;
  const rows = await sql`
    SELECT * FROM (${union}) t ORDER BY at DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

  await auditPaymentViews(
    viewer,
    rows.filter((r) => r.kind === "payment").map((r) => r.record_id),
  );

  const words = (s: string) => s.replace(/_/g, " ");
  const text = (r: (typeof rows)[number]): string => {
    switch (r.kind) {
      case "touchpoint":
        return `Came in via ${words(r.a)}${r.b ? ` (${r.b})` : ""}`;
      case "message":
        return `${r.a === "whatsapp" ? "WhatsApp message" : "Email"} ${r.b === "in" ? "received" : "sent"}`;
      case "stage_change":
        return `Deal for ${r.a} moved to ${words(r.b)}`;
      case "task":
        return `Task ${r.b}: ${r.a}`;
      case "enrolment_change":
        return `Enrolment in ${r.a} is ${words(r.b)}`;
      default:
        return `Payment of ${formatMoneyMyr(r.amount)} ${words(r.b)}`;
    }
  };

  return {
    kind: "ok",
    result: {
      data: rows.map((r) => ({
        at: r.at.toISOString(),
        kind: r.kind,
        text: text(r),
      })),
      page: { total, page, limit },
    },
  };
}

// GET /api/consent/:personId — spec §7. Latest row per purpose (§5 view).
export async function getPersonConsent(
  id: string,
  viewer: Viewer,
): Promise<{ kind: "ok"; consent: ConsentState[] } | Found> {
  if (!can(viewer, "consent").allowed) return { kind: "forbidden" };
  const found = await findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const sql = db();
  const rows = await sql`
    SELECT purpose, is_granted, recorded_at FROM consent_current
    WHERE person_id = ${found.person.id}
      AND purpose IN ('marketing_email', 'marketing_whatsapp')
    ORDER BY purpose`;
  return {
    kind: "ok",
    consent: rows.map((r) => ({
      purpose: r.purpose,
      isGranted: r.is_granted,
      recordedAt: r.recorded_at.toISOString(),
    })),
  };
}

export type UpdateResult =
  | { kind: "updated"; person: PersonDetail["person"] }
  | { kind: "stale" }
  | { kind: "invalid"; fields: Record<string, string> }
  | {
      kind: "duplicate";
      on: "email" | "phone";
      existing: { id: string; fullName: string };
    }
  | Found;

const blankToNull = (s: string) => (s === "" ? null : s);

// PATCH /api/people/:id — spec §7. `loadedUpdatedAt` is the If-Match
// value: the updated_at the client loaded. Anything else = stale.
export async function updatePerson(
  id: string,
  patch: PersonUpdate,
  loadedUpdatedAt: string,
  viewer: Viewer,
): Promise<UpdateResult> {
  if (!permissionFor(viewer, "person", "write").allowed)
    return { kind: "forbidden" };

  return withTransaction(async (): Promise<UpdateResult> => {
    const sql = db();
    const found = await findVisible(id, viewer);
    if (found.kind !== "ok") return found;
    // Lock the row so the stale check and the write can't interleave (§7).
    const [locked] = await sql`
      SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
      FROM person WHERE id = ${id} FOR UPDATE`;
    if (locked.updated_at !== loadedUpdatedAt) return { kind: "stale" };
    const p = found.person;

    const set: Record<string, string | boolean | null> = {};
    const fields: Record<string, string> = {};

    if (patch.fullName !== undefined) set.full_name = patch.fullName;
    if (patch.preferredName !== undefined)
      set.preferred_name = blankToNull(patch.preferredName);
    if (patch.preferredLanguage !== undefined)
      set.preferred_language = patch.preferredLanguage;
    if (patch.jobTitle !== undefined)
      set.job_title = blankToNull(patch.jobTitle);
    if (patch.notes !== undefined) set.notes = blankToNull(patch.notes);
    if (patch.email !== undefined) set.email = blankToNull(patch.email);

    let newPhoneE164 = p.phone_e164;
    if (patch.phone !== undefined) {
      const phone = blankToNull(patch.phone);
      newPhoneE164 = phone ? normalizePhoneE164(phone) : null;
      set.phone = phone;
      set.phone_e164 = newPhoneE164;
      // §4: an unnormalisable phone is kept and flagged, never dropped;
      // fixing it clears a flag that was only there for the phone.
      if (phone && !newPhoneE164) {
        set.needs_review = true;
        set.needs_review_reason = "phone_unnormalised";
      } else if (p.needs_review_reason === "phone_unnormalised") {
        set.needs_review = false;
        set.needs_review_reason = null;
      }
    }

    if (patch.whatsapp !== undefined) {
      // whatsapp_e164 has no "as typed" column, so it must normalise.
      const e164 = patch.whatsapp ? normalizePhoneE164(patch.whatsapp) : null;
      if (patch.whatsapp && !e164)
        fields.whatsapp = "Enter a Malaysian mobile number";
      else set.whatsapp_e164 = e164;
    }

    if (patch.ownerId !== undefined) {
      if (patch.ownerId === null) set.owner_user_id = null;
      else {
        const [owner] = isUuid(patch.ownerId)
          ? await sql`SELECT id FROM app_user WHERE id = ${patch.ownerId} AND is_active`
          : [];
        if (!owner) fields.ownerId = "That owner doesn't exist";
        else set.owner_user_id = owner.id;
      }
    }

    if (Object.keys(fields).length) return { kind: "invalid", fields };
    if (!Object.keys(set).length)
      return { kind: "updated", person: toDetailPerson(p, viewer) };

    // §9.2: saving a phone or email that belongs to someone else → 409.
    const candidate = {
      fullName: (set.full_name as string | undefined) ?? p.full_name,
      emailNorm:
        typeof set.email === "string" ? normalizeEmail(set.email) : null,
      phoneE164: patch.phone !== undefined ? newPhoneE164 : null,
      companyNorm: null,
    };
    if (candidate.emailNorm || candidate.phoneE164) {
      const dup = findDuplicate(
        candidate,
        await dedupeCandidates(candidate, id),
      );
      if (dup.kind === "hard")
        return {
          kind: "duplicate",
          on: dup.on,
          existing: { id: dup.match.id, fullName: dup.match.fullName },
        };
    }

    const columns = Object.keys(set);
    await sql`UPDATE person SET ${sql(set, columns)} WHERE id = ${id}`;
    // §12.9: editing a field never touches last_activity_at.

    const row = p as unknown as Record<string, unknown>;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "person",
      entityId: id,
      before: Object.fromEntries(columns.map((c) => [c, row[c] ?? null])),
      after: set,
    });

    const [fresh] = await sql<
      PersonRow[]
    >`${selectPerson(sql)} WHERE p.id = ${id}`;
    return { kind: "updated", person: toDetailPerson(fresh, viewer) };
  });
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
  const found = await findVisible(id, viewer);
  if (found.kind !== "ok") return found;
  const p = found.person;
  const sql = db();

  const data = {
    person: {
      id: p.id,
      fullName: p.full_name,
      preferredName: p.preferred_name,
      email: p.email,
      phone: p.phone,
      whatsapp: p.whatsapp_e164,
      preferredLanguage: p.preferred_language,
      jobTitle: p.job_title,
      notes: p.notes,
      company: p.company_name,
      createdAt: p.created_at.toISOString(),
    },
    touchpoints: await sql`
      SELECT occurred_at, channel, utm_source, utm_medium, utm_campaign, landing_url, form_name
      FROM touchpoint WHERE person_id = ${p.id} ORDER BY occurred_at`,
    deals: await sql`
      SELECT d.id, d.pipeline, d.stage, c.name_en AS course, d.amount_myr, d.created_at
      FROM deal d LEFT JOIN course c ON c.id = d.course_id
      WHERE d.person_id = ${p.id} AND d.deleted_at IS NULL ORDER BY d.created_at`,
    enrolments: await sql`
      SELECT e.id, cl.code AS class, e.status, e.price_paid_myr, e.created_at
      FROM enrolment e JOIN class cl ON cl.id = e.class_id
      WHERE e.person_id = ${p.id} ORDER BY e.created_at`,
    payments: await sql`
      SELECT id, method, amount_myr, status, paid_at
      FROM (${paymentsSql(sql, p.id, viewer)}) x ORDER BY created_at`,
    enquiries: await sql`
      SELECT id, channel, category, status, created_at
      FROM enquiry WHERE person_id = ${p.id} ORDER BY created_at`,
    consent: await sql`
      SELECT purpose, is_granted, source, recorded_at
      FROM consent WHERE person_id = ${p.id} ORDER BY recorded_at`,
  };

  await writeAudit({
    userId: viewer.id,
    action: "export",
    entity: "person",
    entityId: p.id,
    before: null,
    after: { kind: "pdpa_data_export", format },
  });
  // Round-trip through JSON so Dates become ISO strings for both formats.
  return { kind: "ok", data: JSON.parse(JSON.stringify(data)) };
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
