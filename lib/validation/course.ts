import { z } from "zod";

// GET /api/courses — spec §7 list conventions; `?active=true` (v1.6).
export const courseListQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CourseListQuery = z.output<typeof courseListQuerySchema>;
