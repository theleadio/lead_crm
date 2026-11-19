import { z } from "zod";
import { ROLES } from "../auth/permissions.ts";
import { isValidEmail } from "../format/email.ts";

// Bodies of /api/users (§7, §9.15 Users). No employment type: the column is
// unused, and the Part-timer role is what limits access (17 Nov 2026).

const roleCode = z.enum(ROLES, "Pick one of the roles");

// PATCH /api/users/:id. Email and name are not editable (design Non-Goals).
export const userUpdateSchema = z
  .strictObject({
    roleCode: roleCode.optional(),
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
});
export type UserCreate = z.output<typeof userCreateSchema>;
