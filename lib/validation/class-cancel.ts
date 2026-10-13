import { z } from "zod";

// POST /api/classes/:id/cancel — spec §7, §9.10. The reason is required: it is
// what the audit row and the ClassCancelled event carry, and what Operations
// reads later to explain the refunds (§11.1).
export const classCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required")
    .max(500, "The reason is too long"),
});

export type ClassCancel = z.infer<typeof classCancelSchema>;
