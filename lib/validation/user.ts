import { z } from "zod";
import { ROLES } from "../auth/permissions.ts";

// Bodies of /api/users (§7, §9.15 Users). The add-user body (company email,
// name, role, employment type) arrives with Google sign-in in phase 2.

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
