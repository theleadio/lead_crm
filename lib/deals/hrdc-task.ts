import { writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";
import { db } from "../sql.ts";

// Spec §12.6 (v1.6): the hrdc_deadline reminder task. Two callers raise it —
// the stage move on entering `funding` (lib/deals/stage-service.ts) and the
// deal edit when the deadline date arrives or moves (9.6). One copy of the
// SQL here so they cannot drift. No worker creates this task (§11.1).
//
// Migration 004 allows at most one open hrdc_deadline task per deal, so the
// insert upserts on that partial unique index instead of checking first.
//
// Always called inside the caller's transaction (lib/sql.ts withTransaction),
// so the task and the deal change commit together.

export type DealForHrdcTask = {
  id: string;
  personId: string;
  ownerUserId: string | null;
  stage: string;
  fundingType: string | null;
  // Plain YYYY-MM-DD, or null when there is no deadline (spec §4).
  hrdcDeadlineDate: string | null;
};

// The stage move's half: entering `funding` raises the task, and re-entering
// it moves an open task's due date. Never closes anything — a move away from
// funding leaves the reminder alone.
export async function raiseHrdcDeadlineTask(
  deal: DealForHrdcTask,
  viewer: Viewer,
): Promise<void> {
  if (deal.fundingType !== "hrdc" || !deal.hrdcDeadlineDate) return;
  await upsertTask(deal, viewer);
}

// The edit's half, given the deal as it is after the save:
//  - hrdc, in funding, with a date  -> raise or re-date
//  - date cleared, or funding off hrdc -> close the open task
//  - hrdc with a date but not yet in funding -> nothing; entering funding
//    raises it (spec: an edit does not raise the task before funding)
export async function syncHrdcDeadlineTask(
  deal: DealForHrdcTask,
  viewer: Viewer,
): Promise<void> {
  const withdrawn = deal.fundingType !== "hrdc" || !deal.hrdcDeadlineDate;
  if (withdrawn) await closeOpenTask(deal, viewer);
  else if (deal.stage === "funding") await upsertTask(deal, viewer);
}

// Due at the start of the deadline day in Kuala Lumpur, assigned to the deal
// owner. If a task is already open, its due date follows the deal.
async function upsertTask(deal: DealForHrdcTask, viewer: Viewer) {
  const sql = db();
  const [task] = await sql`
    WITH prev AS (
      SELECT due_at FROM task
      WHERE deal_id = ${deal.id} AND type = 'hrdc_deadline' AND done_at IS NULL
    )
    INSERT INTO task (type, title, person_id, deal_id, assigned_user_id, due_at, created_by)
    VALUES ('hrdc_deadline', 'HRDC deadline', ${deal.personId}, ${deal.id},
            ${deal.ownerUserId},
            (${deal.hrdcDeadlineDate}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'),
            ${viewer.id})
    ON CONFLICT (deal_id) WHERE type = 'hrdc_deadline' AND done_at IS NULL
    DO UPDATE SET due_at = EXCLUDED.due_at
    RETURNING id, (xmax = 0) AS inserted, due_at,
              (SELECT due_at FROM prev) AS prev_due`;
  // Same date again: nothing changed, so nothing to audit.
  if (!task.inserted && +task.prev_due === +task.due_at) return;
  await writeAudit({
    userId: viewer.id,
    action: task.inserted ? "create" : "update",
    entity: "task",
    entityId: task.id,
    before: task.inserted ? null : { due_at: task.prev_due },
    after: {
      type: "hrdc_deadline",
      dealId: deal.id,
      assignedUserId: deal.ownerUserId,
      dueDate: deal.hrdcDeadlineDate,
    },
  });
}

// The deadline was withdrawn. `task` has no cancelled state (migration 001:
// done_at + done_by only), so the reminder is closed rather than left
// pointing at a date that no longer exists (proposal Q2, decided 29 Sep).
async function closeOpenTask(deal: DealForHrdcTask, viewer: Viewer) {
  const [task] = await db()`
    UPDATE task SET done_at = now(), done_by = ${viewer.id}
    WHERE deal_id = ${deal.id} AND type = 'hrdc_deadline' AND done_at IS NULL
    RETURNING id, due_at`;
  if (!task) return;
  await writeAudit({
    userId: viewer.id,
    action: "update",
    entity: "task",
    entityId: task.id,
    before: { due_at: task.due_at, done_at: null },
    after: {
      type: "hrdc_deadline",
      dealId: deal.id,
      closed: "hrdc deadline withdrawn",
    },
  });
}
