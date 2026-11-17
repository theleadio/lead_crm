import { z } from "zod";
import { ROLES } from "../auth/permissions.ts";

// Bodies of /api/users (§7, §9.15 Users). The add-user body (company email,
// name, role) arrives with sign-in in phase 2. No employment type: unused.

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
