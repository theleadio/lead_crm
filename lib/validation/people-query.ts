import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

// Spec §7 sort=: allow-listed, `-` prefix = descending. Never interpolated;
// lib/people/service.ts maps each value to a fixed SQL fragment.
export const PEOPLE_SORTS = [
  "name",
  "-name",
  "created",
  "-created",
  "lastActivity",
  "-lastActivity",
] as const;

// Spec §7 list conventions: ?q=&page=&limit=&filter[...]. Default limit 25, max 100.
export const peopleFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  stage: z.enum(["lead", "student", "customer"]).optional(),
  language: z.enum(["en", "zh"]).optional(),
  needsReview: bool,
  owner: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  hasOpenDeal: bool,
  createdFrom: isoDate,
  createdTo: isoDate,
  sort: z.enum(PEOPLE_SORTS).optional(),
});

export const peopleListQuerySchema = peopleFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Reads the URL shape shared by the list and export endpoints.
export function readPeopleParams(sp: URLSearchParams) {
  const tags = sp.getAll("filter[tag]");
  return {
    q: sp.get("q") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    stage: sp.get("filter[stage]") ?? undefined,
    language: sp.get("filter[language]") ?? undefined,
    needsReview: sp.get("filter[needsReview]") ?? undefined,
    owner: sp.get("filter[owner]") ?? undefined,
    tags: tags.length ? tags : undefined,
    hasOpenDeal: sp.get("filter[hasOpenDeal]") ?? undefined,
    createdFrom: sp.get("filter[createdFrom]") ?? undefined,
    createdTo: sp.get("filter[createdTo]") ?? undefined,
    sort: sp.get("sort") ?? undefined,
  };
}

// Spec §7.1: {personIds[], action, ownerId?, tagId?}, max 500.
// ownerId null (or omitted) with assign_owner means "no owner".
export const bulkPeopleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_owner"),
    personIds: z.array(z.string().max(100)).min(1).max(500),
    ownerId: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("add_tag"),
    personIds: z.array(z.string().max(100)).min(1).max(500),
    tagId: z.string().min(1),
  }),
]);
