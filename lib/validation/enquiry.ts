import { z } from "zod";
import {
  ENQUIRY_CATEGORIES,
  ENQUIRY_CLOSE_STATUSES,
} from "../enquiries/types.ts";

// Body of PATCH /api/enquiries/:id (§7, §9.13). One route, three actions, each
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
    category: z.enum(ENQUIRY_CATEGORIES, "Pick a category from the list"),
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
