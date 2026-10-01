import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import {
  canWriteDeal,
  permissionFor,
  type Viewer,
} from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { syncHrdcDeadlineTask } from "./hrdc-task.ts";
import {
  CORPORATE_GATED_STAGES,
  missingCorporateFields,
} from "./stage-rules.ts";
import type {
  DealDetail,
  DealEnrolment,
  DealTask,
  DealUpdate,
  LinkedEnquiry,
  StageHistoryEntry,
} from "./types.ts";

// Service layer for spec §9.6 Deal detail: GET /api/deals/:id (§7.1) and
// PATCH /api/deals/:id (§7). Stage is not written here — it moves through
// moveDealStage() in stage-service.ts, the only writer of deal.stage (§12.5).

export type DetailResult =
  | { kind: "ok"; deal: DealDetail }
  | { kind: "not_found" }
  | { kind: "forbidden" };

export type UpdateResult =
  | { kind: "ok"; deal: DealDetail }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "stale" }
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "corporate_fields_missing"; stage: string; missing: string[] }
  | { kind: "lost_reason_required"; message: string };

const ref = (id: string | null, name: string | null) =>
  id ? { id, name: name ?? "" } : null;

// GET /api/deals/:id. Five lookups in one query, then history, tasks and
// enrolments together — a detail view, so the panels are unpaginated.
export async function getDealDetail(
  id: string,
  viewer: Viewer,
): Promise<DetailResult> {
  if (!permissionFor(viewer, "deal", "read").allowed)
    return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };

  const sql = db();
  const [row] =
    await sql`SELECT ${dealSql(sql)} WHERE d.id = ${id} AND d.deleted_at IS NULL`;
  if (!row) return { kind: "not_found" };

  const [history, tasks, enrolments, enquiries] = await Promise.all([
    sql`SELECT h.id, h.from_stage, h.to_stage, h.changed_at, u.full_name AS changed_by
        FROM deal_stage_history h
        LEFT JOIN app_user u ON u.id = h.changed_by
        WHERE h.deal_id = ${id} ORDER BY h.changed_at DESC, h.id DESC`,
    sql`SELECT t.id, t.type, t.title, t.due_at, t.done_at, u.full_name AS assigned_to
        FROM task t LEFT JOIN app_user u ON u.id = t.assigned_user_id
        WHERE t.deal_id = ${id}
        ORDER BY (t.done_at IS NOT NULL), t.due_at NULLS LAST, t.id`,
    sql`SELECT e.id, e.status, e.price_paid_myr, c.code AS class_code
        FROM enrolment e LEFT JOIN class c ON c.id = e.class_id
        WHERE e.deal_id = ${id} ORDER BY e.created_at`,
    sql`SELECT id, channel, category, status, first_message_at
        FROM enquiry WHERE deal_id = ${id}
        ORDER BY first_message_at NULLS LAST, id LIMIT 1`,
  ]);

  return {
    kind: "ok",
    deal: toDetail(row, history, tasks, enrolments, enquiries[0]),
  };
}

// The deal with its five lookups. Expects deal aliased as `d`.
function dealSql(sql: postgres.Sql) {
  return sql`
    d.id, d.pipeline, d.stage, d.headcount, d.amount_myr, d.funding_type,
    d.hrdc_grant_ref,
    d.hrdc_approval_date::text AS hrdc_approval_date,
    d.hrdc_deadline_date::text AS hrdc_deadline_date,
    d.won_at, d.lost_at, d.stage_changed_at, d.created_at,
    d.checkout_url, d.checkout_sent_at,
    d.version::int AS version,
    p.id AS person_id, p.full_name AS person_name,
    comp.id AS company_id, comp.legal_name AS company_name,
    co.id AS course_id, co.name_en AS course_name,
    cl.id AS class_id, cl.code AS class_code,
    u.id AS owner_id, u.full_name AS owner_name,
    lr.id AS lost_reason_id, lr.code AS lost_reason_code, lr.label_en AS lost_reason_label
  FROM deal d
  JOIN person p ON p.id = d.person_id
  LEFT JOIN company comp ON comp.id = d.company_id
  LEFT JOIN course co ON co.id = d.course_id
  LEFT JOIN class cl ON cl.id = d.class_id
  LEFT JOIN app_user u ON u.id = d.owner_user_id
  LEFT JOIN lost_reason lr ON lr.id = d.lost_reason_id`;
}

function toDetail(
  r: postgres.Row,
  history: postgres.Row[],
  tasks: postgres.Row[],
  enrolments: postgres.Row[],
  enquiry: postgres.Row | undefined,
): DealDetail {
  return {
    id: r.id,
    pipeline: r.pipeline,
    stage: r.stage,
    person: { id: r.person_id, name: r.person_name },
    company: ref(r.company_id, r.company_name),
    course: ref(r.course_id, r.course_name),
    class: ref(r.class_id, r.class_code),
    owner: ref(r.owner_id, r.owner_name),
    headcount: r.headcount,
    amountMyr: r.amount_myr,
    fundingType: r.funding_type,
    hrdcGrantRef: r.hrdc_grant_ref,
    hrdcApprovalDate: r.hrdc_approval_date,
    hrdcDeadlineDate: r.hrdc_deadline_date,
    lostReason: r.lost_reason_id
      ? {
          id: r.lost_reason_id,
          code: r.lost_reason_code,
          labelEn: r.lost_reason_label,
        }
      : null,
    wonAt: iso(r.won_at),
    lostAt: iso(r.lost_at),
    stageChangedAt: new Date(r.stage_changed_at).toISOString(),
    checkoutUrl: r.checkout_url,
    checkoutSentAt: iso(r.checkout_sent_at),
    createdAt: new Date(r.created_at).toISOString(),
    version: r.version,
    stageHistory: history.map((h): StageHistoryEntry => ({
      id: h.id,
      fromStage: h.from_stage,
      toStage: h.to_stage,
      changedAt: new Date(h.changed_at).toISOString(),
      changedBy: h.changed_by,
    })),
    tasks: tasks.map((t): DealTask => ({
      id: t.id,
      type: t.type,
      title: t.title,
      dueAt: iso(t.due_at),
      assignedTo: t.assigned_to,
      doneAt: iso(t.done_at),
    })),
    enquiry: enquiry
      ? ({
          id: enquiry.id,
          channel: enquiry.channel,
          category: enquiry.category,
          status: enquiry.status,
          firstMessageAt: iso(enquiry.first_message_at),
        } satisfies LinkedEnquiry)
      : null,
    enrolments: enrolments.map((e): DealEnrolment => ({
      id: e.id,
      classCode: e.class_code,
      status: e.status,
      pricePaidMyr: e.price_paid_myr,
    })),
  };
}

const iso = (v: Date | null) => (v ? new Date(v).toISOString() : null);

// The nine editable fields, mapped to their columns. Stage, pipeline, person,
// class and the server-set timestamps are absent on purpose (proposal Q1).
const COLUMNS = {
  companyId: "company_id",
  courseId: "course_id",
  headcount: "headcount",
  amountMyr: "amount_myr",
  fundingType: "funding_type",
  hrdcGrantRef: "hrdc_grant_ref",
  hrdcApprovalDate: "hrdc_approval_date",
  hrdcDeadlineDate: "hrdc_deadline_date",
  ownerId: "owner_user_id",
  lostReasonId: "lost_reason_id",
} as const;

// PATCH /api/deals/:id. One transaction, deal locked, If-Match in the
// UPDATE's WHERE so a stale edit is 0 rows rather than a second read.
export async function updateDeal(
  id: string,
  body: DealUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<UpdateResult> {
  if (!canWriteDeal(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };

  return withTransaction(async (): Promise<UpdateResult> => {
    const sql = db();
    const [deal] = await sql`
      SELECT id, pipeline, stage, person_id, company_id, course_id, class_id,
             owner_user_id, headcount, amount_myr, funding_type, hrdc_grant_ref,
             lost_reason_id,
             hrdc_approval_date::text AS hrdc_approval_date,
             hrdc_deadline_date::text AS hrdc_deadline_date
      FROM deal WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    if (!deal) return { kind: "not_found" };

    const invalid = await checkReferences(body);
    if (invalid) return { kind: "invalid", fields: invalid };

    const lost = await checkLostReason(body, deal.stage);
    if (lost) return lost;

    // Funding type off hrdc clears the three HRDC values in the same save
    // (§12.6 fields belong to hrdc funding only).
    const patch: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS))
      if (body[key as keyof DealUpdate] !== undefined)
        patch[column] = body[key as keyof DealUpdate];
    if (body.fundingType !== undefined && body.fundingType !== "hrdc") {
      patch.hrdc_grant_ref = null;
      patch.hrdc_approval_date = null;
      patch.hrdc_deadline_date = null;
    }

    // §12.5: a corporate deal past discovery keeps company, headcount and
    // funding type. Refused here so the 001 CHECK never reports it.
    const after = { ...deal, ...patch };
    if (CORPORATE_GATED_STAGES.includes(deal.stage)) {
      const missing = missingCorporateFields({
        pipeline: after.pipeline,
        companyId: after.company_id,
        headcount: after.headcount,
        fundingType: after.funding_type,
      });
      if (missing.length)
        return { kind: "corporate_fields_missing", stage: deal.stage, missing };
    }

    // §7 (v1.7): the row's integer version, bumped by the 005 trigger. No
    // row matched means either someone else saved first or the deal is gone
    // — the deal was read FOR UPDATE above, so it still exists here and the
    // answer is `stale`; a deleted deal already returned not_found.
    const [updated] = await sql`
      UPDATE deal SET ${sql(patch)}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id`;
    if (!updated) return { kind: "stale" };

    // Only the fields that actually changed (§4 audit).
    const before: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(patch))
      if (String(deal[column] ?? "") !== String(value ?? "")) {
        before[column] = deal[column];
        changed[column] = value;
      }
    if (Object.keys(changed).length)
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "deal",
        entityId: id,
        before,
        after: changed,
      });

    await syncHrdcDeadlineTask(
      {
        id,
        personId: deal.person_id,
        ownerUserId: after.owner_user_id,
        stage: deal.stage,
        fundingType: after.funding_type,
        hrdcDeadlineDate: after.hrdc_deadline_date,
      },
      viewer,
    );

    // Editing a field is not contact activity (§12.9) — no
    // touchPersonActivity call here, deliberately.
    const result = await getDealDetail(id, viewer);
    return result.kind === "ok"
      ? { kind: "ok", deal: result.deal }
      : { kind: "not_found" };
  });
}

// Every id in the body must name a live record. Checked before any write so
// a bad id is a 400 with a field message, not a foreign-key error.
async function checkReferences(
  body: DealUpdate,
): Promise<Record<string, string> | null> {
  const sql = db();
  const fields: Record<string, string> = {};

  if (body.companyId) {
    const rows =
      await sql`SELECT 1 FROM company WHERE id = ${body.companyId} AND deleted_at IS NULL`;
    if (!rows.length) fields.companyId = "That company doesn't exist.";
  }
  if (body.courseId) {
    const rows = await sql`SELECT 1 FROM course WHERE id = ${body.courseId}`;
    if (!rows.length) fields.courseId = "That course doesn't exist.";
  }
  if (body.ownerId) {
    const rows =
      await sql`SELECT 1 FROM app_user WHERE id = ${body.ownerId} AND is_active`;
    if (!rows.length) fields.ownerId = "Pick an active user.";
  }

  return Object.keys(fields).length ? fields : null;
}

// §12.5 + proposal Q4: while the deal is lost, the reason may be swapped for
// another active one. Never cleared, never set on another stage. A
// correction, so no history row and no event.
async function checkLostReason(
  body: DealUpdate,
  stage: string,
): Promise<UpdateResult | null> {
  if (body.lostReasonId === undefined) return null;
  if (stage !== "lost")
    return {
      kind: "lost_reason_required",
      message:
        "A lost reason belongs to a lost deal. Move the deal to Lost instead.",
    };
  // The 001 CHECK keeps a lost deal's reason present, so it cannot be cleared.
  if (body.lostReasonId === null)
    return {
      kind: "lost_reason_required",
      message: "A lost deal keeps a reason. Pick another one instead.",
    };
  const [reason] = await db()`
    SELECT id FROM lost_reason WHERE id = ${body.lostReasonId} AND is_active`;
  if (!reason)
    return {
      kind: "lost_reason_required",
      message: "Pick an active lost reason.",
    };
  return null;
}
