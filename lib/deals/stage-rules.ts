import { STAGES, STAGE_LABELS, type Pipeline, type Stage } from "./types.ts";

// Spec §12.5 deal stages and the §12.6 won guard, as a pure function so the
// rules are testable without a database. The deal CHECK constraints in
// migration 001 stay as the backstop; this runs first so the caller gets a
// named 422 instead of a raw constraint error.

export type DealForMove = {
  pipeline: Pipeline;
  stage: Stage;
  companyId: string | null;
  headcount: number | null;
  fundingType: string | null;
  hrdcGrantRef: string | null;
  hrdcApprovalDate: string | null;
  hrdcDeadlineDate: string | null;
};

export type MoveCode =
  | "invalid_stage"
  | "lost_reason_required"
  | "corporate_fields_missing"
  | "hrdc_fields_missing";

export type MoveCheck =
  | { ok: true; noop: boolean }
  | { ok: false; code: MoveCode; missing?: string[] };

// Spec §12.5: a corporate deal past discovery needs a company, a headcount
// and a funding type — the 001 CHECK in other words. Shared by the stage
// move (below) and the deal edit (9.6), which must refuse the same fields
// with the same names before the CHECK can fire.
export function missingCorporateFields(
  deal: Pick<
    DealForMove,
    "pipeline" | "companyId" | "headcount" | "fundingType"
  >,
): string[] {
  if (deal.pipeline !== "corporate") return [];
  return [
    !deal.companyId && "companyId",
    deal.headcount == null && "headcount",
    !deal.fundingType && "fundingType",
  ].filter((f): f is string => !!f);
}

// The stages a corporate deal cannot hold without those three fields.
export const CORPORATE_GATED_STAGES = ["proposal_sent", "funding", "won"];

// Where an incomplete corporate deal can actually be found, and so where the
// board marks one (9.5). Complements CORPORATE_GATED_STAGES rather than
// repeating it: `lost` is in neither — a lost deal may be incomplete, but it
// is not moving forward, so marking it would be noise.
export const INCOMPLETE_STAGES = ["new", "discovery"];

// `reason` is the lost_reason row named by lostReasonId, or null when none
// was sent or it doesn't exist. Ignored unless toStage is lost.
export function checkMove(
  deal: DealForMove,
  toStage: string,
  reason: { isActive: boolean } | null,
): MoveCheck {
  if (toStage === deal.stage) return { ok: true, noop: true };
  if (!(STAGES[deal.pipeline] as readonly string[]).includes(toStage))
    return { ok: false, code: "invalid_stage" };

  if (toStage === "lost" && !reason?.isActive)
    return { ok: false, code: "lost_reason_required" };

  if (CORPORATE_GATED_STAGES.includes(toStage)) {
    const missing = missingCorporateFields(deal);
    if (missing.length)
      return { ok: false, code: "corporate_fields_missing", missing };
  }

  if (toStage === "won" && deal.fundingType === "hrdc") {
    const missing = [
      !deal.hrdcGrantRef?.trim() && "hrdcGrantRef",
      !deal.hrdcApprovalDate && "hrdcApprovalDate",
      !deal.hrdcDeadlineDate && "hrdcDeadlineDate",
    ].filter((f): f is string => !!f);
    if (missing.length)
      return { ok: false, code: "hrdc_fields_missing", missing };
  }

  return { ok: true, noop: false };
}

const FIELD_LABELS: Record<string, string> = {
  companyId: "company",
  headcount: "headcount",
  fundingType: "funding type",
  hrdcGrantRef: "HRDC grant reference",
  hrdcApprovalDate: "HRDC approval date",
  hrdcDeadlineDate: "HRDC deadline date",
};

// The edit's wording for the same rule (9.6): the deal is already in the
// gated stage, so it cannot be moved to it — the field has to stay.
export function keepCorporateFieldsMessage(
  stage: string,
  missing: string[],
): string {
  const at = STAGE_LABELS[stage as Stage] ?? stage;
  const fields = missing.map((f) => FIELD_LABELS[f] ?? f).join(", ");
  return `A corporate deal in ${at} needs ${fields}. Move it back to Discovery first if you need to clear that.`;
}

// Spec §13: say what happened and what to do.
export function moveErrorMessage(
  code: MoveCode,
  toStage: string,
  missing: string[] = [],
): string {
  const to = STAGE_LABELS[toStage as Stage] ?? toStage;
  switch (code) {
    case "invalid_stage":
      return `${to} isn't a stage in this deal's pipeline.`;
    case "lost_reason_required":
      return "Pick an active lost reason to mark this deal lost.";
    case "corporate_fields_missing":
    case "hrdc_fields_missing":
      return `Add ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")} on the deal before moving it to ${to}.`;
  }
}
