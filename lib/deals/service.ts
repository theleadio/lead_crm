import type postgres from "postgres";
import type { Viewer } from "../auth/permissions.ts";
import { db } from "../sql.ts";
import { INCOMPLETE_STAGES, missingCorporateFields } from "./stage-rules.ts";
import {
  STAGES,
  type DealCard,
  type DealListQuery,
  type DealListResponse,
  type LostReasonOption,
  type StageTotal,
} from "./types.ts";

// Service layer for spec §9.5 Deals board. Deal read is not row-restricted
// for the roles that have it (§6: no "A" on the deal row); part_time is
// refused at the route. "My deals" is a filter, not a permission.

// Board card columns. Expects deal aliased as `d`.
export function cardSql(sql: postgres.Sql) {
  return sql`
    d.id, d.pipeline, d.stage, d.amount_myr, d.funding_type, d.stage_changed_at,
    d.company_id, d.headcount,
    d.updated_at::text AS version,
    p.id AS person_id, p.full_name AS person_name,
    co.id AS course_id, co.name_en AS course_name,
    u.id AS owner_id, u.full_name AS owner_name
  FROM deal d
  JOIN person p ON p.id = d.person_id
  LEFT JOIN course co ON co.id = d.course_id
  LEFT JOIN app_user u ON u.id = d.owner_user_id`;
}

export function toCard(r: postgres.Row): DealCard {
  return {
    id: r.id,
    pipeline: r.pipeline,
    stage: r.stage,
    person: { id: r.person_id, fullName: r.person_name },
    course: r.course_id ? { id: r.course_id, name: r.course_name } : null,
    amountMyr: r.amount_myr,
    owner: r.owner_id ? { id: r.owner_id, fullName: r.owner_name } : null,
    stageChangedAt: new Date(r.stage_changed_at).toISOString(),
    fundingType: r.funding_type,
    // The stage gate lives here, not in missingCorporateFields(): the stage
    // move asks the same question about the stage it is moving *to*.
    missingFields: INCOMPLETE_STAGES.includes(r.stage)
      ? missingCorporateFields({
          pipeline: r.pipeline,
          companyId: r.company_id,
          headcount: r.headcount,
          fundingType: r.funding_type,
        })
      : [],
    version: r.version,
  };
}

// Every filter except stage: stageTotals covers the whole filtered set, and
// a per-column request must not zero the other headers (design decision 3).
function filterSql(sql: postgres.Sql, q: DealListQuery, viewer: Viewer) {
  // Dates are Asia/Kuala_Lumpur days (spec §4); createdTo is inclusive.
  return sql`d.deleted_at IS NULL AND d.pipeline = ${q.pipeline}
    ${q.owner ? sql`AND d.owner_user_id = ${q.owner}` : sql``}
    ${q.mine ? sql`AND d.owner_user_id = ${viewer.id}` : sql``}
    ${q.course ? sql`AND d.course_id = ${q.course}` : sql``}
    ${q.funding ? sql`AND d.funding_type = ${q.funding}` : sql``}
    ${
      q.incomplete
        ? sql`AND d.pipeline = 'corporate' AND d.stage IN ${sql(INCOMPLETE_STAGES)}
              AND (d.company_id IS NULL OR d.headcount IS NULL OR d.funding_type IS NULL)`
        : sql``
    }
    ${q.createdFrom ? sql`AND d.created_at >= (${q.createdFrom}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')` : sql``}
    ${q.createdTo ? sql`AND d.created_at < ((${q.createdTo}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')` : sql``}`;
}

// GET /api/deals — spec §7 + §7.1 stageTotals. Oldest in stage first.
export async function listDeals(
  q: DealListQuery,
  viewer: Viewer,
): Promise<DealListResponse> {
  const sql = db();
  const where = filterSql(sql, q, viewer);
  const cardWhere = sql`${where} ${q.stage ? sql`AND d.stage = ${q.stage}` : sql``}`;

  const [[{ total }], rows, totals] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM deal d WHERE ${cardWhere}`,
    sql`SELECT ${cardSql(sql)} WHERE ${cardWhere}
        ORDER BY d.stage_changed_at, d.id
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    // Summed in SQL, never by adding JS numbers (spec §12.7).
    sql`SELECT d.stage, count(*)::int AS count,
               coalesce(sum(d.amount_myr), 0)::numeric(14,2)::text AS total
        FROM deal d WHERE ${where} GROUP BY d.stage`,
  ]);

  const byStage = new Map(totals.map((t) => [t.stage, t]));
  const stageTotals: StageTotal[] = STAGES[q.pipeline].map((stage) => ({
    stage,
    count: byStage.get(stage)?.count ?? 0,
    totalMyr: byStage.get(stage)?.total ?? "0.00",
  }));

  return {
    data: rows.map(toCard),
    page: { total, page: q.page, limit: q.limit },
    stageTotals,
  };
}

// GET /api/lost-reasons — spec §7.1. Active only, in order.
export async function listLostReasons(): Promise<LostReasonOption[]> {
  const rows = await db()`
    SELECT id, code, label_en FROM lost_reason
    WHERE is_active ORDER BY sort_order, label_en`;
  return rows.map((r) => ({ id: r.id, code: r.code, labelEn: r.label_en }));
}
