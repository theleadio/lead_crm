import { z } from "zod";

// Fields per spec §5 `course`, §9.7. Shared by the API routes and the form.

// §5 `course_track`. The CHECK constraint is the real gate; this keeps a bad
// track a 400 with a field message instead of a 500 from the database.
export const COURSE_TRACKS = [
  "certification",
  "mastery",
  "masterclass",
  "workshop",
  "conference",
  "corporate",
] as const;
export type CourseTrack = (typeof COURSE_TRACKS)[number];

// Trimmed, because the unique index treats "AIA " and "AIA" as two codes and
// §8.2 matches a website lead's courseInterest on the stored value.
const code = z
  .string()
  .trim()
  .min(1, "Course code is required")
  .max(50, "Course code is too long");
const nameEn = z
  .string()
  .trim()
  .min(1, "English name is required")
  .max(300, "Name is too long");
const nameZh = z.string().trim().max(300).optional();
const track = z.enum(COURSE_TRACKS, {
  message: "Pick one of the §5 course tracks",
});
const durationDays = z
  .number()
  .int("Duration is a whole number of days")
  .positive("Duration is at least 1 day");
// numeric(12,2) as a string — never a JS number (spec §4, §12.7).
const listPriceMyr = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a price like 3200 or 3200.00")
  .or(z.literal(""))
  .nullable()
  .optional();

// POST /api/courses — §9.7. A new course is active unless told otherwise.
export const courseCreateSchema = z
  .object({
    code,
    nameEn,
    nameZh,
    track,
    durationDays,
    listPriceMyr,
    hrdcClaimable: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CourseCreate = z.output<typeof courseCreateSchema>;

// PATCH /api/courses/:id — partial: a field left out keeps its stored value,
// and description_en/description_zh (not on the 9.7 form) are never touched.
export const courseUpdateSchema = z
  .object({
    code: code.optional(),
    nameEn: nameEn.optional(),
    nameZh,
    track: track.optional(),
    durationDays: durationDays.optional(),
    listPriceMyr,
    hrdcClaimable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to save" });
export type CourseUpdate = z.output<typeof courseUpdateSchema>;

// GET /api/courses — spec §7 list conventions; `?active=true` (v1.6).
// `sort` is an allow-list, like people and companies.
export const COURSE_SORTS = [
  "code",
  "-code",
  "name",
  "-name",
  "created",
  "-created",
] as const;

export const courseListQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sort: z.enum(COURSE_SORTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CourseListQuery = z.output<typeof courseListQuerySchema>;
