import { z } from "zod";

// PATCH /api/class-notices/:id — spec §9.10, §7.1. The wording of a pending
// notice only: `changed_fields` and `recipient_count` are what the notice is
// about and are not editable, so they are not here.

// Non-empty after trim: an approved notice with a blank message would be an
// empty WhatsApp to every student on the class.
const message = z
  .string()
  .trim()
  .min(1, "The message can't be empty")
  .max(2000, "The message is too long");

export const classNoticeEditSchema = z
  .object({ messageEn: message.optional(), messageZh: message.optional() })
  .refine((v) => v.messageEn !== undefined || v.messageZh !== undefined, {
    message: "Send at least one message to change",
  });

export type ClassNoticeEdit = z.infer<typeof classNoticeEditSchema>;
