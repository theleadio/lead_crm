import { z } from "zod";
import {
  ACTIVE_STATUSES,
  CATEGORY_CODE,
  ENQUIRY_CLOSE_STATUSES,
  ENQUIRY_PRIORITIES,
} from "../enquiries/types.ts";

// Body of PATCH /api/enquiries/:id (§7, §9.13). One route, five actions, each
// validated on its own (design: one PATCH with a discriminated body). Convert
// is not here: it creates a deal and is its own route.

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick someone from the list",
  );

export const enquiryUpdateSchema = z.discriminatedUnion("action", [
  // "me" is the signed-in user; null clears the assignment.
  z.object({
    action: z.literal("assign"),
    assignee: z.union([uuid, z.literal("me"), z.null()]),
  }),
  z.object({
    action: z.literal("category"),
    // A code from enquiry_category; the service checks it is active.
    category: z.string().regex(CATEGORY_CODE, "Pick a category from the list"),
  }),
  // Between the two working states only: closing has its own action, and
  // closing is final.
  z.object({
    action: z.literal("status"),
    status: z.enum(ACTIVE_STATUSES, "Pick open or waiting on the customer"),
  }),
  z.object({
    action: z.literal("priority"),
    priority: z.enum(ENQUIRY_PRIORITIES, "Pick low, normal or high"),
  }),
  // `ai_resolved` and `converted` are refused here outright: the first is
  // Shawn's side's to write, the second needs a deal (§5).
  z.object({
    action: z.literal("close"),
    status: z.enum(ENQUIRY_CLOSE_STATUSES, "Pick resolved or closed"),
    note: z
      .string()
      .trim()
      .min(1, "Say what the outcome was")
      .max(2000, "Keep the note under 2,000 characters"),
  }),
]);
export type EnquiryUpdate = z.output<typeof enquiryUpdateSchema>;

// POST /api/enquiries/:id/notes. Internal: never sent to the customer.
export const enquiryNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, "Write the note first")
    .max(5000, "Keep the note under 5,000 characters"),
});

// POST /api/enquiries: one made by hand (a call, a walk-in) for someone
// already in the CRM.
export const enquiryCreateSchema = z.object({
  personId: uuid,
  category: z.string().regex(CATEGORY_CODE, "Pick a category from the list"),
  subject: z
    .string()
    .trim()
    .min(1, "Add a subject")
    .max(200, "Keep the subject under 200 characters"),
  channel: z
    .enum(["phone", "walk_in", "email", "whatsapp", "messenger", "instagram"])
    .default("phone"),
  priority: z.enum(ENQUIRY_PRIORITIES).default("normal"),
  note: z
    .string()
    .trim()
    .max(5000, "Keep the note under 5,000 characters")
    .optional(),
});
export type EnquiryCreate = z.output<typeof enquiryCreateSchema>;

// POST /api/enquiries/:id/convert (§9.13). The rest of the deal (company,
// headcount, amount, funding) is filled on the deal itself afterwards.
export const enquiryConvertSchema = z.object({
  pipeline: z.enum(["individual", "corporate"], "Pick individual or corporate"),
  courseId: uuid.nullable().optional(),
});
