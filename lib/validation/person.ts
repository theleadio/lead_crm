import { z } from "zod";
import { isValidEmail } from "../format/email.ts";

// Fields per spec §5 `person` table. Shared by API routes and forms so both
// reject the same things (spec §7). No first/last split (§4 Names).
export const personSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  preferredName: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .refine(isValidEmail, "Enter a valid email address")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  preferredLanguage: z.enum(["en", "zh"]).default("en"),
  jobTitle: z.string().trim().optional(),
  notes: z.string().optional(),
});

export type PersonInput = z.infer<typeof personSchema>;

// PATCH /api/people/:id — partial (spec §7). A field left out is unchanged;
// an empty string clears it. Full name can change but never be emptied.
const clearable = z.string().trim().max(500);
export const personUpdateSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").optional(),
  preferredName: clearable.optional(),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidEmail(v), "Enter a valid email address")
    .optional(),
  phone: clearable.optional(),
  whatsapp: clearable.optional(),
  preferredLanguage: z.enum(["en", "zh"]).optional(),
  jobTitle: clearable.optional(),
  notes: z.string().max(10_000).optional(),
  ownerId: z.string().nullable().optional(),
});

export type PersonUpdate = z.infer<typeof personUpdateSchema>;
