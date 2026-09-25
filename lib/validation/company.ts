import { z } from "zod";
import { isValidEmail } from "../format/email.ts";

// Fields per spec §5 `company`. Shared by the API routes and the forms.
const text = z.string().trim().max(500);
const fields = {
  registrationNo: text.optional(),
  industry: text.optional(),
  sizeBand: text.optional(),
  hrdcRegistered: z.boolean().optional(),
  billingAddress: z.string().trim().max(2000).optional(),
  billingEmail: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidEmail(v), "Enter a valid email address")
    .optional(),
  ownerId: z.string().nullable().optional(),
};

// POST /api/companies. Blank strings are stored as null.
export const companyCreateSchema = z.object({
  legalName: z.string().trim().min(1, "Company name is required").max(500),
  ...fields,
});
export type CompanyCreate = z.infer<typeof companyCreateSchema>;

// PATCH /api/companies/:id — partial; a field left out is unchanged, an
// empty string clears it, the name can change but never be emptied.
export const companyUpdateSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(500)
    .optional(),
  ...fields,
});
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;

// GET /api/companies — spec §7 list (?q=&sort=&page=&limit=&filter[...]).
// similarTo / registrationNo / excludeId drive the Add and Edit company
// "Similar companies" warning (§9.4).
const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const companyListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  hrdcRegistered: bool,
  hasOpenDeal: bool,
  similarTo: z.string().trim().max(500).optional(),
  registrationNo: z.string().trim().max(500).optional(),
  excludeId: z.string().max(100).optional(),
  sort: z.enum(["name", "-name"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// POST /api/companies/:id/members — spec §7. `replaceCurrent` (used by the
// 9.2 picker) ends the person's other current memberships in the same
// transaction.
export const memberSchema = z.object({
  personId: z.string().min(1, "Pick a person"),
  jobTitle: z.string().trim().max(200).optional(),
  isHrContact: z.boolean().default(false),
  isBillingContact: z.boolean().default(false),
  replaceCurrent: z.boolean().default(false),
});
export type MemberInput = z.infer<typeof memberSchema>;

// PATCH /api/companies/:id/members/:membershipId — edit or end (§7.1).
// Ending is one-way and rows are never deleted.
export const membershipUpdateSchema = z.object({
  jobTitle: z.string().trim().max(200).optional(),
  isHrContact: z.boolean().optional(),
  isBillingContact: z.boolean().optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-24")
    .optional(),
});
export type MembershipUpdate = z.infer<typeof membershipUpdateSchema>;
