import { z } from "zod";

// Bodies of /api/tags/:id and /api/tags/:id/merge (§7.1, §9.15 Tags).

export const tagUpdateSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, "Give the tag a name")
      .max(100, "Keep the name under 100 characters")
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to change",
    path: ["name"],
  });
export type TagUpdate = z.output<typeof tagUpdateSchema>;

export const tagMergeSchema = z.object({
  intoTagId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Pick a tag from the list",
    )
    .transform((v) => v.toLowerCase()),
});
