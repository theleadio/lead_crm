// SalesProcess (GoHighLevel) opportunities → CRM deals (cutover plan WP4).
// Run by scripts/import-ghl-opportunities.ts, after ghl:import (contacts).
//
// Rules (agreed 5 Nov):
//  - one individual deal per opportunity, written with plain SQL: no lead or
//    stage code, so no LeadCaptured / DealStageChanged events (imports never
//    fire events; no CRM trigger writes event_outbox on a deal insert).
//  - insert only, keyed on deal.external_ref 'ghl-opp:<id>' (migration 017):
//    a deal already imported is never touched again, so a nightly run can't
//    overwrite what staff did in the CRM.
//  - the person is the one ghl:import made for the contact (touchpoint
//    'ghl:<contact id>'); never matched by email or phone, never merged.
//    Not imported yet → skipped, picked up by the next run.
//  - a person with an open CRM deal for the same course is skipped: no second
//    card on the board.
//  - course from the pipeline (one per programme); class only when the
//    title or source names a date of an existing class of that course.
//  - no consent rows: a SalesProcess opportunity is not proof of opt-in.
import { parseClassSlot } from "./class-slot.ts";
import { pickClass, type ClassCandidate } from "./salesprocess-enrolments.ts";
import { db } from "../sql.ts";

export type GhlOpportunity = {
  id: string;
  name?: string | null;
  monetaryValue?: number | null;
  pipelineId: string;
  pipelineStageId: string;
  assignedTo?: string | null;
  status: string; // open | won | lost | abandoned
  source?: string | null;
  contactId: string;
  createdAt: string;
  lastStageChangeAt?: string | null;
  lastStatusChangeAt?: string | null;
};
export type GhlPipeline = {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
};
export type GhlUser = { id: string; email?: string | null };

type Stage = "new" | "engaged" | "qualified" | "checkout_sent" | "won" | "lost";

const STAGES: Record<string, { stage: Stage; tag?: string }> = {
  "new lead (opt-in)": { stage: "new" },
  "contact attempted": { stage: "new", tag: "contact_attempted" },
  "engaged / qualifying": { stage: "engaged" },
  "proposal / quote sent": { stage: "qualified" },
  "pending payment / hrdf": { stage: "checkout_sent" },
  "closed won": { stage: "won" },
  "closed lost": { stage: "lost" },
};

// SalesProcess status beats the stage: a won opportunity can sit in any column.
export function mapStage(
  stageName: string,
  status: string,
): { stage: Stage; tag?: string } | null {
  if (status === "won") return { stage: "won" };
  if (status === "lost" || status === "abandoned") return { stage: "lost" };
  return STAGES[stageName.trim().toLowerCase()] ?? null;
}

// Pipelines are named "<programme> - Sales Pipeline".
const PIPELINE_COURSE: Record<string, string> = {
  AIA8: "lms-ai-agentic-automation-certification",
  AIEC: "lms-professional-ai-engineering-certification",
  AIVC: "lms-ai-full-stack-building-certification",
  AIDA: "lms-ai-for-data-science-certification",
};
export function courseCodeFor(pipelineName: string): string | null {
  return PIPELINE_COURSE[pipelineName.split(" - ")[0].trim()] ?? null;
}

export async function importOpportunities(input: {
  opportunities: GhlOpportunity[];
  pipelines: GhlPipeline[];
  users: GhlUser[];
}): Promise<Record<string, number>> {
  const sql = db();
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

  const done = new Set(
    (
      await sql`SELECT external_ref FROM deal WHERE external_ref LIKE 'ghl-opp:%'`
    ).map((r) => r.external_ref),
  );
  const personOf = new Map(
    (
      await sql`
        SELECT t.external_ref, t.person_id FROM touchpoint t JOIN person p ON p.id = t.person_id
        WHERE t.channel = 'import' AND t.external_ref LIKE 'ghl:%' AND p.deleted_at IS NULL`
    ).map((r) => [(r.external_ref as string).slice(4), r.person_id as string]),
  );
  const stageName = new Map(
    input.pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name])),
  );
  const pipelineCourse = new Map(
    input.pipelines.map((p) => [p.id, courseCodeFor(p.name)]),
  );
  const courseId = new Map(
    (
      await sql`SELECT id, code FROM course WHERE code = ANY(${Object.values(PIPELINE_COURSE)})`
    ).map((r) => [r.code as string, r.id as string]),
  );
  const classes = new Map<string, ClassCandidate[]>(); // course id|start
  for (const c of await sql`
    SELECT id, course_id, start_date::text AS start, language FROM class
    WHERE course_id = ANY(${[...courseId.values()]}) AND status <> 'cancelled'`) {
    const k = `${c.course_id}|${c.start}`;
    classes.set(k, [
      ...(classes.get(k) ?? []),
      { id: c.id, language: c.language },
    ]);
  }
  const open = new Set(
    (
      await sql`
        SELECT person_id, course_id FROM deal
        WHERE deleted_at IS NULL AND stage NOT IN ('won','lost') AND course_id IS NOT NULL`
    ).map((r) => `${r.person_id}|${r.course_id}`),
  );
  const userByEmail = new Map(
    (await sql`SELECT id, lower(email) AS email FROM app_user`).map((r) => [
      r.email as string,
      r.id as string,
    ]),
  );
  const ownerOf = new Map(
    input.users
      .filter((u) => u.email)
      .map((u) => [u.id, userByEmail.get(u.email!.toLowerCase())]),
  );
  const [lostReason] =
    await sql`SELECT id FROM lost_reason WHERE code = 'imported_unknown'`;
  if (!lostReason)
    throw new Error(
      "lost reason imported_unknown missing: apply migration 017",
    );

  for (const o of input.opportunities) {
    const ref = `ghl-opp:${o.id}`;
    if (done.has(ref)) {
      bump("skip: already imported");
      continue;
    }
    const name = stageName.get(o.pipelineStageId) ?? o.pipelineStageId;
    const mapped = mapStage(name, o.status);
    if (!mapped) {
      bump(`skip: unknown stage ${name}`);
      continue;
    }
    const personId = personOf.get(o.contactId);
    if (!personId) {
      bump("skip: contact not imported yet");
      continue;
    }
    const code = pipelineCourse.get(o.pipelineId) ?? null;
    const course = code ? (courseId.get(code) ?? null) : null;
    if (!course) bump("  of which: no course");
    const closed = mapped.stage === "won" || mapped.stage === "lost";
    if (course && !closed && open.has(`${personId}|${course}`)) {
      bump("skip: open CRM deal for this course");
      continue;
    }

    // The title is "<person> - <course> | <dates> | <venue>" or just the name.
    const title = (o.name ?? "").split(" - ").slice(1).join(" - ");
    const created = new Date(o.createdAt);
    const slot = course ? parseClassSlot([title, o.source], created) : null;
    const picked = slot
      ? pickClass(classes.get(`${course}|${slot.start}`) ?? [], slot.language)
      : null;
    const classId = picked && picked !== "ambiguous" ? picked : null;
    if (slot && !classId) bump("  of which: date named, no CRM class");

    const stageAt = new Date(o.lastStageChangeAt ?? o.createdAt);
    const closedAt = new Date(
      o.lastStatusChangeAt ?? o.lastStageChangeAt ?? o.createdAt,
    );
    const [tp] = await sql`
      INSERT INTO touchpoint (person_id, occurred_at, channel, form_name, external_ref)
      VALUES (${personId}, ${created}, 'import', ${o.source?.slice(0, 200) || "ghl-opportunity"}, ${ref})
      ON CONFLICT DO NOTHING RETURNING id`;
    const touchpointId =
      tp?.id ??
      (
        await sql`SELECT id FROM touchpoint WHERE channel = 'import' AND external_ref = ${ref}`
      )[0].id;
    const [deal] = await sql`
      INSERT INTO deal ${sql({
        pipeline: "individual",
        stage: mapped.stage,
        person_id: personId,
        course_id: course,
        class_id: classId,
        amount_myr:
          o.monetaryValue && o.monetaryValue > 0 ? o.monetaryValue : null,
        owner_user_id: (o.assignedTo && ownerOf.get(o.assignedTo)) || null,
        won_at: mapped.stage === "won" ? closedAt : null,
        lost_at: mapped.stage === "lost" ? closedAt : null,
        lost_reason_id: mapped.stage === "lost" ? lostReason.id : null,
        created_at: created,
        stage_changed_at: stageAt,
        source_touchpoint_id: touchpointId,
        external_ref: ref,
      } as never)}
      RETURNING id`;
    await sql`
      INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_at)
      VALUES (${deal.id}, NULL, ${mapped.stage}, ${stageAt})`;
    if (mapped.tag) {
      await sql`INSERT INTO tag (name, is_system) VALUES (${mapped.tag}, false) ON CONFLICT DO NOTHING`;
      await sql`
        INSERT INTO person_tag (person_id, tag_id)
        SELECT ${personId}, id FROM tag WHERE lower(name) = ${mapped.tag}
        ON CONFLICT DO NOTHING`;
    }
    if (course && !closed) open.add(`${personId}|${course}`);
    done.add(ref);
    bump("new deal");
  }
  return stats;
}
