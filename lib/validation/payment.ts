import { z } from "zod";

// Body for §9.12 Record manual payment (`POST /api/payments/manual`, §7).
// Every field is required except notes. Amounts stay decimal strings, never JS
// numbers (§4, §12.7).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Not a valid id",
  );

// §9.12: bank transfer, HRDC or invoice. The two Stripe methods are not
// recordable by hand — that money arrives by webhook (§4, §5).
export const MANUAL_PAYMENT_METHODS = [
  "bank_transfer",
  "hrdc",
  "invoice",
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

// numeric(12,2) as a string, like `priceMyr` in `validation/class.ts`. The
// `> 0` test counts digits rather than calling Number(), so "0.00" and
// "0000.00" are both caught without a float ever holding the amount (§12.7).
const amountMyr = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 3200 or 3200.00")
  .refine((value) => /[1-9]/.test(value), "Enter an amount above zero");

// §5 CHECK: a manual payment must carry one. Not unique and never checked for
// an existing payment — one invoice for ten students is ten payments sharing
// one reference (§9.12 One invoice, several students).
const referenceNo = z
  .string()
  .trim()
  .min(1, "Enter the reference number")
  .max(100, "That reference number is too long");

// The key `POST /api/uploads/sign` minted (design 2). The service still checks
// it against the enrolment it was issued for; this only refuses a shape that
// should never reach the store.
const proofKey = z
  .string()
  .trim()
  .min(1, "Attach the payment proof")
  .max(200, "That proof key is too long")
  .refine(
    (key) => !key.includes("..") && !key.startsWith("/"),
    "Not a valid proof key",
  );

// Today in the timezone the business works in, as an ISO date. ISO dates sort
// lexicographically, so the comparison below needs no Date arithmetic.
function todayInKualaLumpur(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
}

// §9.12 HRDC: a payment is recorded when the money has arrived, so the date is
// the day it was received and cannot be in the future.
const paidOn = z.iso
  .date("Enter a date like 2026-10-09")
  .refine(
    (date) => date <= todayInKualaLumpur(),
    "A payment can't be dated in the future",
  );

export const paymentManualSchema = z.object({
  enrolmentId: uuid,
  method: z.enum(MANUAL_PAYMENT_METHODS, {
    message: "Pick bank transfer, HRDC or invoice",
  }),
  amountMyr,
  referenceNo,
  paidOn,
  proofKey,
  notes: z.string().trim().max(2000, "Those notes are too long").optional(),
});

export type PaymentManualBody = z.output<typeof paymentManualSchema>;

// Body for `POST /api/uploads/sign` (§7). The enrolment is all the client
// sends: the key itself is minted on the server and prefixed with it, so the
// browser never chooses a path in the bucket (design 2).
export const uploadSignSchema = z.object({ enrolmentId: uuid });

export type UploadSignBody = z.output<typeof uploadSignSchema>;
