import { z } from "zod";
import { CLASS_SIZES } from "../reports/class-size.ts";

// §9.18 ads report: the date range is the whole query. Both dates live in the
// URL under the §7 `filter[...]` convention, so a range can be shared and a
// reload lands on the same numbers.

const TIME_ZONE = "Asia/Kuala_Lumpur";
const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 400;

// Today as a plain YYYY-MM-DD in Kuala Lumpur (§4), not the server's day.
// en-CA formats as YYYY-MM-DD, which is what the schema and the SQL both take.
export function kualaLumpurDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TIME_ZONE,
  }).format(at);
}

// The default window ends today and is DEFAULT_RANGE_DAYS long counting both
// ends, so "last 30 days" is 30 days of data and not 31.
export function defaultRange(at: Date = new Date()) {
  const to = kualaLumpurDay(at);
  const from = kualaLumpurDay(
    new Date(at.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY),
  );
  return { from, to };
}

// Whole days, so the span is a difference of two UTC midnights: no timezone
// arithmetic, and Kuala Lumpur has no DST to shift it (§4).
function spanDays(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1
  );
}

export const adsReportQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    // Which size of class to count. Absent means every size, which is the
    // default view — a report that started filtered would be read as the
    // whole business.
    size: z.enum(CLASS_SIZES).optional(),
  })
  .transform((q) => {
    const fallback = defaultRange();
    return {
      from: q.from ?? fallback.from,
      to: q.to ?? fallback.to,
      size: q.size ?? null,
    };
  })
  // A bad range is refused, never quietly widened or swapped: a corrected
  // range is a wrong number the viewer cannot see is wrong (§9.18).
  .refine((q) => q.from <= q.to, {
    path: ["from"],
    message: "The start date is after the end date",
  })
  .refine((q) => spanDays(q.from, q.to) <= MAX_RANGE_DAYS, {
    path: ["to"],
    message: `Pick a range of ${MAX_RANGE_DAYS} days or fewer`,
  });

export type AdsReportQuery = z.infer<typeof adsReportQuerySchema>;

export function readAdsReportParams(sp: URLSearchParams) {
  const get = (k: string) => sp.get(k) ?? undefined;
  // An unknown size is dropped rather than refused: it comes from a URL, and
  // the date range is the part worth refusing over.
  const size = get("filter[size]");
  return {
    from: get("filter[from]"),
    to: get("filter[to]"),
    size: CLASS_SIZES.includes(size as never) ? size : undefined,
  };
}
