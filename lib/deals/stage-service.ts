import type postgres from "postgres";
import { canWriteDeal, type Viewer } from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { DealStageBody } from "../validation/deal.ts";
import { cardSql, toCard } from "./service.ts";
import { checkMove, type MoveCode } from "./stage-rules.ts";
import type { DealCard, LostReasonOption } from "./types.ts";

export type MovedDeal = DealCard & { lostReason: LostReasonOption | null };

export type MoveResult =
  | { kind: "ok"; deal: MovedDeal }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "rule"; code: MoveCode; missing?: string[] };

// POST /api/deals/:id/stage — spec §12.5 (+ §12.6 won guard and
// hrdc_deadline task). The only writer of deal.stage: the board, deal
// detail, enquiry convert and the website all come through here. One
// transaction with the deal row locked, so two moves of the same deal run
// one after the other and history stays in order.
export async function moveDealStage(
  dealId: string,
  body: DealStageBody,
  viewer: Viewer,
): Promise<MoveResult> {
  if (!canWriteDeal(viewer)) return { kind: "forbidden" };
  if (!isUuid(dealId)) return { kind: "not_found" };

  return withTransaction(async (): Promise<MoveResult> => {
    const sql = db();
    const [deal] = await sql`
      SELECT id, pipeline, stage, person_id, owner_user_id, company_id, headcount,
             funding_type, hrdc_grant_ref, won_at, lost_at, lost_reason_id,
             hrdc_approval_date::text AS hrdc_approval_date,
             hrdc_deadline_date::text AS hrdc_deadline_date
      FROM deal WHERE id = ${dealId} AND deleted_at IS NULL
      FOR UPDATE`;
    if (!deal) return { kind: "not_found" };

    const toStage = body.toStage;
    const reasonId =
      toStage === "lost" && body.lostReasonId && isUuid(body.lostReasonId)
        ? body.lostReasonId
        : null;
    const [reason] = reasonId
      ? await sql`SELECT id, code, label_en, is_active FROM lost_reason WHERE id = ${reasonId}`
      : [];

    const check = checkMove(
      {
        pipeline: deal.pipeline,
        stage: deal.stage,
        companyId: deal.company_id,
        headcount: deal.headcount,
        fundingType: deal.funding_type,
        hrdcGrantRef: deal.hrdc_grant_ref,
        hrdcApprovalDate: deal.hrdc_approval_date,
        hrdcDeadlineDate: deal.hrdc_deadline_date,
      },
      toStage,
      reason ? { isActive: reason.is_active } : null,
    );
    if (!check.ok)
      return { kind: "rule", code: check.code, missing: check.missing };

    if (!check.noop) {
      // Server-set timestamps (§12.5); leaving won/lost clears them.
      const lostReasonId = toStage === "lost" ? reason.id : null;
      await sql`
        UPDATE deal SET
          stage = ${toStage},
          stage_changed_at = now(),
          won_at = ${toStage === "won" ? sql`now()` : sql`NULL`},
          lost_at = ${toStage === "lost" ? sql`now()` : sql`NULL`},
          lost_reason_id = ${lostReasonId}
        WHERE id = ${dealId}`;
      await sql`
        INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by, created_by)
        VALUES (${dealId}, ${deal.stage}, ${toStage}, ${viewer.id}, ${viewer.id})`;
      // Spec §11.1: raised in the same transaction as the move.
      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
        VALUES ('DealStageChanged', 'deal', ${dealId},
                ${sql.json({ dealId, fromStage: deal.stage, toStage, byUserId: viewer.id })},
                ${viewer.id})`;
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "deal",
        entityId: dealId,
        before: {
          stage: deal.stage,
          won_at: deal.won_at,
          lost_at: deal.lost_at,
          lost_reason_id: deal.lost_reason_id,
        },
        after: { stage: toStage, lost_reason_id: lostReasonId },
      });
      if (toStage === "funding") await raiseHrdcDeadlineTask(deal, viewer);
    }

    const [row] = await sql`SELECT ${cardSql(sql)} WHERE d.id = ${dealId}`;
    const [lr] = await sql`
      SELECT lr.id, lr.code, lr.label_en FROM deal d
      JOIN lost_reason lr ON lr.id = d.lost_reason_id WHERE d.id = ${dealId}`;
    return {
      kind: "ok",
      deal: {
        ...toCard(row),
        lostReason: lr
          ? { id: lr.id, code: lr.code, labelEn: lr.label_en }
          : null,
      },
    };
  });
}

// Spec §12.6: entering funding on an HRDC deal raises one hrdc_deadline
// task, due on the deadline date (start of that day in Kuala Lumpur),
// assigned to the owner. No date, no task — 9.6 raises it when the date is
// entered. Never a second open one for the same deal.
async function raiseHrdcDeadlineTask(deal: postgres.Row, viewer: Viewer) {
  if (deal.funding_type !== "hrdc" || !deal.hrdc_deadline_date) return;
  const sql = db();
  const [open] = await sql`
    SELECT 1 FROM task
    WHERE deal_id = ${deal.id} AND type = 'hrdc_deadline' AND done_at IS NULL`;
  if (open) return;
  const [task] = await sql`
    INSERT INTO task (type, title, person_id, deal_id, assigned_user_id, due_at, created_by)
    VALUES ('hrdc_deadline', 'HRDC deadline', ${deal.person_id}, ${deal.id},
            ${deal.owner_user_id},
            (${deal.hrdc_deadline_date}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'),
            ${viewer.id})
    RETURNING id`;
  await writeAudit({
    userId: viewer.id,
    action: "create",
    entity: "task",
    entityId: task.id,
    before: null,
    after: {
      type: "hrdc_deadline",
      dealId: deal.id,
      assignedUserId: deal.owner_user_id,
      dueDate: deal.hrdc_deadline_date,
    },
  });
}
