import { z } from "zod";
import { ROLES } from "../auth/permissions.ts";
import { isValidEmail } from "../format/email.ts";

// Bodies of /api/users (§7, §9.15 Users).

const roleCode = z.enum(ROLES, "Pick one of the roles");
const employmentType = z.enum(
  ["full_time", "part_time"],
  "Pick full time or part time",
);

// PATCH /api/users/:id. Email and name are not editable (design Non-Goals).
export const userUpdateSchema = z
  .strictObject({
    roleCode: roleCode.optional(),
    employmentType: employmentType.optional(),
    isActive: z.boolean("Say whether the account is on").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to change",
    path: ["roleCode"],
  });
export type UserUpdate = z.output<typeof userUpdateSchema>;

// POST /api/users. The email is the one they sign in to AI365 with; it is
// the allowlist entry, matched case-insensitively.
export const userCreateSchema = z.strictObject({
  email: z
    .string("Enter their email")
    .trim()
    .min(1, "Enter their email")
    .max(320, "Keep the email under 320 characters")
    .refine(isValidEmail, "Enter a valid email address"),
  fullName: z
    .string("Enter their name")
    .trim()
    .min(1, "Enter their name")
    .max(200, "Keep the name under 200 characters"),
  roleCode,
  employmentType,
});
export type UserCreate = z.output<typeof userCreateSchema>;
