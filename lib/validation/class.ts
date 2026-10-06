import { z } from "zod";
import { CLASS_LANGUAGES, CLASS_MODES } from "../classes/types.ts";

// Fields per spec §5 `class`, §9.9. Shared by the API routes and the form.
// `status` and `is_public` are deliberately absent: §12.1 derives
// full/few_seats from the seats, and draft/open and the website flag are the
// two §9.10 controls' own actions (design 7, v1.9).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick a course from the list",
  );

// Trimmed: the unique index treats "AIA-1 " and "AIA-1" as two codes.
const code = z
  .string()
  .trim()
  .min(1, "Class code is required")
  .max(50, "Class code is too long");
// `time` columns are display only (§5); HH:MM is what the form sends.
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 09:00");
const text = (max: number) => z.string().trim().max(max);
const capacity = z
  .number()
  .int("Capacity is a whole number")
  .positive("Capacity is at least 1");
const fewSeatsThreshold = z
  .number()
  .int("Threshold is a whole number")
  .min(0, "Threshold is zero or more");
// numeric(12,2) as a string — never a JS number (§4, §12.7).
const priceMyr = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a price like 3200 or 3200.00")
  .or(z.literal(""))
  .nullable()
  .optional();

const base = {
  courseId: uuid,
  code,
  startDate: z.iso.date("Enter a date like 2026-10-06"),
  endDate: z.iso.date("Enter a date like 2026-10-07"),
  startTime: time.nullable().optional(),
  endTime: time.nullable().optional(),
  language: z.enum(CLASS_LANGUAGES, { message: "Pick a language" }),
  mode: z.enum(CLASS_MODES, { message: "Pick how the class runs" }),
  venueName: text(200).nullable().optional(),
  venueAddress: text(500).nullable().optional(),
  city: text(100).nullable().optional(),
  onlineUrl: text(500).nullable().optional(),
  capacity,
  fewSeatsThreshold: fewSeatsThreshold.optional(),
  priceMyr,
  hrdcClaimable: z.boolean().optional(),
};

// The row a conditional check runs against: a create's own values, or a
// patch merged onto what is stored (design 8) — a PATCH that only changes
// `mode` still has to satisfy the venue rules with the stored venue.
export type ClassShape = {
  startDate?: string;
  endDate?: string;
  mode?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  onlineUrl?: string | null;
};

const blank = (v: string | null | undefined) => !v || v.trim() === "";

// §9.9: end_date >= start_date; venue required unless online; online_url
// required unless in_person. The database CHECK constraints are the real
// gate — these turn a 500 into a message against the field.
export function checkClassRules(
  row: ClassShape,
  ctx: z.RefinementCtx,
  // Only complain about a field the request could have set.
  sent: (field: string) => boolean = () => true,
) {
  const fail = (path: string, message: string) => {
    if (sent(path)) ctx.addIssue({ code: "custom", path: [path], message });
  };

  if (row.startDate && row.endDate && row.endDate < row.startDate)
    fail("endDate", "The end date is before the start date");

  if (row.mode && row.mode !== "online") {
    if (blank(row.venueName)) fail("venueName", "Venue name is required");
    if (blank(row.venueAddress))
      fail("venueAddress", "Venue address is required");
    if (blank(row.city)) fail("city", "City is required");
  }
  if (row.mode && row.mode !== "in_person" && blank(row.onlineUrl))
    fail("onlineUrl", "A joining link is required");
}

// POST /api/classes — §9.9 create.
export const classCreateSchema = z
  .object(base)
  .strict()
  .superRefine((row, ctx) => checkClassRules(row, ctx));
export type ClassCreate = z.output<typeof classCreateSchema>;

// PATCH /api/classes/:id — partial. Conditionals run on the merged row in
// the service, which knows the stored values; here only what was sent is
// shape-checked.
export const classUpdateSchema = z
  .object({
    courseId: uuid.optional(),
    code: code.optional(),
    startDate: base.startDate.optional(),
    endDate: base.endDate.optional(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    language: base.language.optional(),
    mode: base.mode.optional(),
    venueName: text(200).nullable().optional(),
    venueAddress: text(500).nullable().optional(),
    city: text(100).nullable().optional(),
    onlineUrl: text(500).nullable().optional(),
    capacity: capacity.optional(),
    fewSeatsThreshold: fewSeatsThreshold.optional(),
    priceMyr,
    hrdcClaimable: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to save" });
export type ClassUpdate = z.output<typeof classUpdateSchema>;

// §7.1: the choice the 9.9 dialog sends back after a 409
// notice_decision_required. Absent is what triggers that 409.
export const classNoticeChoiceSchema = z.enum(["prepare", "skip"]).optional();
export type ClassNoticeChoice = z.output<typeof classNoticeChoiceSchema>;

// The two §9.10 controls (§12.1, v1.9). Separate routes, so no single request
// can write `status` and `is_public` together except Back to draft, which
// clears `is_public` in the service.
export const classStatusSchema = z
  .object({ status: z.enum(["open", "draft"]) })
  .strict();
export const classVisibilitySchema = z
  .object({ isPublic: z.boolean() })
  .strict();
