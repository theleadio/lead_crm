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
