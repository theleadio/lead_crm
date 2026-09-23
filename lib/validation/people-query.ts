import { z } from "zod";

// Spec §7 list conventions: ?q=&page=&limit=&filter[...]. Default limit 25, max 100.
export const peopleListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  stage: z.enum(["lead", "student", "customer"]).optional(),
  language: z.enum(["en", "zh"]).optional(),
  needsReview: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
