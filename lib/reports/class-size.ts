// §9.18: the three sizes of class the business actually runs, so a report can
// be read one kind at a time. A two-day certification and a two-hour online
// workshop differ by a factor of fourteen in price and by far more in effort;
// averaged together they describe nothing.
//
//   big     certifications, two days, RM 3,200   (AI Engineering, Data Science)
//   middle  one-day mastery and workshops, RM 680 (Vibe Coding, Claude AI)
//   small   online workshops, RM 228
//
// Banded on the course's own list price, not on its name or its `track`. The
// LMS sets `track` from the title — "certification" in the name or "mastery"
// in it, else "workshop" — so AI Vibe Coding (RM 680, a day in a room) and the
// AI Agents Online Workshop (RM 228, two hours on Zoom) are both "workshop"
// there and nothing in the title separates them. Price does.
//
// An unpriced course has no size rather than a guessed one: it is left out of
// a filtered view and the panel says the view is filtered.

export const CLASS_SIZES = ["big", "middle", "small"] as const;
export type ClassSize = (typeof CLASS_SIZES)[number];

// Where the bands sit, in MYR. The gaps are wide on purpose — the real prices
// cluster at 3,200, 680 and 228, so a price has to move a long way before it
// changes size, and a promo or an SST-inclusive figure will not move it.
export const SIZE_FLOOR = { big: 2000, middle: 400 } as const;

export const SIZE_LABEL: Record<ClassSize, string> = {
  big: "Big — certifications",
  middle: "Middle — one-day mastery",
  small: "Small — online workshops",
};

export const SIZE_NOTE: Record<ClassSize, string> = {
  big: "two-day certifications, around RM 3,200",
  middle: "one-day mastery classes and in-person workshops, around RM 680",
  small: "online workshops, around RM 228",
};

export function classSize(
  listPriceMyr: string | number | null | undefined,
): ClassSize | null {
  if (listPriceMyr === null || listPriceMyr === undefined) return null;
  const price = Number(listPriceMyr);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price >= SIZE_FLOOR.big) return "big";
  if (price >= SIZE_FLOOR.middle) return "middle";
  return "small";
}

// `null` means every size, which is the default view: a report that silently
// started filtered would be read as the whole business.
export function matchesSize(
  listPriceMyr: string | number | null | undefined,
  wanted: ClassSize | null,
): boolean {
  return wanted === null || classSize(listPriceMyr) === wanted;
}
