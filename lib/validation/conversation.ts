import { z } from "zod";
import { CATEGORY_CODE } from "../enquiries/types.ts";

// Bodies of /api/conversations/:id (the inbox, migration 019).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick someone from the list",
  );

export const conversationUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    assignee: z.union([uuid, z.null()]),
  }),
  z.object({
    action: z.literal("status"),
    status: z.enum(["open", "snoozed", "closed"]),
  }),
]);

// "Make enquiry" from a conversation.
export const conversationEnquirySchema = z.object({
  category: z.string().regex(CATEGORY_CODE, "Pick a category from the list"),
  subject: z
    .string()
    .trim()
    .min(1, "Add a subject")
    .max(200, "Keep the subject under 200 characters"),
});
