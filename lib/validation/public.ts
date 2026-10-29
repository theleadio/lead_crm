import { z } from "zod";
import { isValidEmail } from "../format/email.ts";

// Spec §8: the public API's input rules. Every string has a length limit —
// this is the trust boundary, so nothing here is open-ended (spec §14).

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

// GET /api/public/schedule (§8.1). All optional; never more than 100 rows (§14).
export const scheduleQuerySchema = z.object({
  language: z.enum(["en", "zh"]).optional(),
  track: z
    .enum([
      "certification",
      "mastery",
      "masterclass",
      "workshop",
      "conference",
      "corporate",
    ])
    .optional(),
  city: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

const attributionSchema = z.object({
  utmSource: text(200),
  utmMedium: text(200),
  utmCampaign: text(200),
  utmContent: text(200),
  utmTerm: text(200),
  gclid: text(200),
  fbclid: text(500),
  gbraid: text(200),
  wbraid: text(200),
  liFatId: text(200),
  ttclid: text(200),
  landingUrl: text(2000),
  referrer: text(2000),
  firstTouch: z
    .object({
      utmSource: text(200),
      utmMedium: text(200),
      utmCampaign: text(200),
      occurredAt: text(40),
    })
    .nullish(),
});

// POST /api/public/leads (§8.2). Required: fullName and one of email/phone.
export const leadSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Letters, digits and _ . : - only")
      .nullish()
      .transform((v) => v || null),
    formName: text(200),
    fullName: z.string().trim().min(1, "Full name is required").max(200),
    email: z
      .string()
      .trim()
      .max(254)
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || isValidEmail(v), "Enter a valid email"),
    phone: text(40),
    companyName: text(200),
    jobTitle: text(200),
    preferredLanguage: z
      .enum(["en", "zh"])
      .nullish()
      .transform((v) => v ?? "en"),
    courseInterest: text(50),
    classCode: text(50),
    message: text(2000),
    consentMarketing: z
      .boolean()
      .nullish()
      .transform((v) => v === true),
    hrdcIntended: z
      .boolean()
      .nullish()
      .transform((v) => v === true),
    attribution: attributionSchema.nullish(),
    captchaToken: z.string().max(4096).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone)
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email or a phone number",
      });
  });
export type LeadInput = z.output<typeof leadSchema>;
