import { z } from "zod";

// Bodies of /api/lost-reasons (§7.1, §9.15 Lost reasons).

const labelEn = z
  .string()
  .trim()
  .min(1, "Give the reason a name")
  .max(100, "Keep the name under 100 characters");
// Blank clears the Chinese label.
const labelZh = z
  .string()
  .trim()
  .max(100, "Keep the name under 100 characters")
  .transform((v) => v || null)
  .nullable();

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Reload the page and try again",
  )
  .transform((v) => v.toLowerCase());

export const lostReasonCreateSchema = z.object({
  // Reports group by the code (§5), so it is fixed once created.
  code: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9_]+$/,
      "Use lowercase letters, numbers and underscores only",
    )
    .max(50, "Keep the code under 50 characters"),
  labelEn,
  labelZh: labelZh.default(null),
});
export type LostReasonCreate = z.output<typeof lostReasonCreateSchema>;

// Strict: a `code` in the body is refused (422), never ignored.
export const lostReasonUpdateSchema = z
  .strictObject({
    labelEn: labelEn.optional(),
    labelZh: labelZh.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to change",
    path: ["labelEn"],
  });
export type LostReasonUpdate = z.output<typeof lostReasonUpdateSchema>;

// Design 7: the complete order, every reason once.
export const lostReasonReorderSchema = z.object({
  ids: z.array(uuid).min(1, "Reload the page and try again"),
});
