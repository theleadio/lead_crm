import { z } from "zod";
import {
  ALL_STAGES,
  FUNDING_TYPES,
  PIPELINES,
  STAGES,
  type Stage,
} from "../deals/types.ts";

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Not a valid id",
  );

// GET /api/deals — spec §7 list conventions plus §7.1 stageTotals.
// filter[pipeline] is required: the board is one pipeline per tab (§9.5).
export const dealListQuerySchema = z
  .object({
    pipeline: z.enum(PIPELINES),
    stage: z.enum(ALL_STAGES as [Stage, ...Stage[]]).optional(),
    owner: uuid.optional(),
    course: uuid.optional(),
    funding: z.enum(FUNDING_TYPES).optional(),
    createdFrom: z.iso.date().optional(),
    createdTo: z.iso.date().optional(),
    mine: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (q) =>
      !q.stage || (STAGES[q.pipeline] as readonly Stage[]).includes(q.stage),
    { path: ["stage"], message: "That stage isn't in this pipeline" },
  );

export function readDealParams(sp: URLSearchParams) {
  const get = (k: string) => sp.get(k) ?? undefined;
  return {
    pipeline: get("filter[pipeline]"),
    stage: get("filter[stage]"),
    owner: get("filter[owner]"),
    course: get("filter[course]"),
    funding: get("filter[funding]"),
    createdFrom: get("filter[createdFrom]"),
    createdTo: get("filter[createdTo]"),
    mine: get("filter[mine]"),
    page: get("page"),
    limit: get("limit"),
  };
}

// POST /api/deals/:id/stage — spec §7 body {toStage, lostReasonId?}. The
// stage itself is checked against the deal's pipeline by the service, so an
// unknown stage is a 422 invalid_stage (§12.5), not a 400.
export const dealStageBodySchema = z.object({
  toStage: z.string().trim().min(1, "Pick a stage").max(50),
  lostReasonId: z.string().max(100).nullish(),
});
export type DealStageBody = z.infer<typeof dealStageBodySchema>;
