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
    // Corporate deals in new/discovery missing a §12.5 field (9.5).
    incomplete: z
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
    incomplete: get("filter[incomplete]"),
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

// PATCH /api/deals/:id — spec §9.6 / §7. Strict: an unknown key is a 400,
// `stage` above all, because stage moves through POST /api/deals/:id/stage
// and a silently ignored `stage` would hide a missing history row.
// `.optional()` (not `.nullish()`) keeps "not sent" (untouched) apart from
// "sent as null" (clear).
const nullableUuid = uuid.nullable().optional();

export const dealUpdateSchema = z
  .object({
    companyId: nullableUuid,
    courseId: nullableUuid,
    ownerId: nullableUuid,
    headcount: z
      .number()
      .int("Headcount is a whole number")
      .positive("Headcount is at least 1")
      .nullable()
      .optional(),
    // numeric(12,2) as a string — never a JS number (spec §4, §12.7).
    amountMyr: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 4500 or 4500.00")
      .nullable()
      .optional(),
    fundingType: z.enum(FUNDING_TYPES).nullable().optional(),
    hrdcGrantRef: z.string().trim().max(100).nullable().optional(),
    hrdcApprovalDate: z.iso.date().nullable().optional(),
    hrdcDeadlineDate: z.iso.date().nullable().optional(),
    // Only a correction on an already-lost deal; the service refuses it on
    // any other stage, and refuses clearing it (§12.5, proposal Q4).
    lostReasonId: nullableUuid,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Nothing to save",
  });
export type DealUpdateBody = z.infer<typeof dealUpdateSchema>;
