import { z } from "zod";
import { ENROLMENT_STATUSES } from "../enrolments/status-rules.ts";

// Bodies for the §9.11 writes: POST /api/enrolments, POST /api/enrolments/:id/
// status and POST /api/enrolments/:id/transfer (§7.1).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Not a valid id",
  );

const reason = z
  .string()
  .trim()
  .min(1, "A reason is required")
  .max(500, "The reason is too long");

// §12.1 / §12.6: a staff create reserves a seat or waits for an offline
// payment. `confirmed` is reached by recording a payment (§9.12) or by a status
// change, never by a create, so it is not in this enum.
export const ENROLMENT_CREATE_STATUSES = [
  "reserved",
  "payment_pending",
] as const;

// Not `.strict()`: §8.3 says the price always comes from the class record on
// the server, so an `amount` or `pricePaidMyr` in the body is dropped here
// rather than answered with a 400. Nothing the client sends can reach money.
export const enrolmentCreateSchema = z.object({
  personId: uuid,
  classId: uuid,
  status: z.enum(ENROLMENT_CREATE_STATUSES, {
    message: "Pick Reserved or Payment pending",
  }),
  payerType: z.enum(["self", "company"], { message: "Pick who is paying" }),
  // The HR officer who registered them (§5); absent for a self-booking.
  bookerPersonId: uuid.nullable().optional(),
});

export type EnrolmentCreate = z.infer<typeof enrolmentCreateSchema>;

// §12.4 is checked against the stored status in the service, not here: a body
// is only well-formed or not. A move to `cancelled` carries the reason the
// row stores and the EnrolmentCancelled event reports (§11.1).
export const enrolmentStatusSchema = z
  .object({
    toStatus: z.enum(ENROLMENT_STATUSES),
    reason: reason.optional(),
  })
  .refine((b) => b.toStatus !== "cancelled" || Boolean(b.reason), {
    message: "A reason is required",
    path: ["reason"],
  });

export type EnrolmentStatusBody = z.infer<typeof enrolmentStatusSchema>;

export const enrolmentTransferSchema = z.object({
  toClassId: uuid,
});

export type EnrolmentTransferBody = z.infer<typeof enrolmentTransferSchema>;
