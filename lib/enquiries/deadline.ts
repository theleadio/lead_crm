// The first-reply deadline of an enquiry (decided 4 Nov for tickets; one rule
// for the whole queue since migration 019): the same time on
// the next working day, counted in office hours.
//
//   Office hours: Monday–Friday, 08:30 to 16:30, Malaysia time.
//   Working day:  Monday–Friday and not in `holiday` (national plus
//                 KL/Selangor public holidays).
//   An enquiry that arrives outside office hours counts from the next opening
//   (08:30 on the next working day).
//
//   Tue 10:00 → Wed 10:00
//   Fri 15:00 → Mon 15:00
//   Fri 17:00 (after hours) → counts from Mon 08:30 → due Tue 08:30
//
// Malaysia time is UTC+8 all year (no daylight saving), so a fixed offset
// is exact and needs no time-zone database.

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const OPEN_MINUTES = 8 * 60 + 30; // 08:30
export const CLOSE_MINUTES = 16 * 60 + 30; // 16:30, not itself open

// A day in Malaysia, as days since 1970-01-01 (MYT).
const mytDay = (t: Date) => Math.floor((t.getTime() + MYT_OFFSET_MS) / DAY_MS);
const minutesInto = (t: Date) =>
  Math.floor(((t.getTime() + MYT_OFFSET_MS) % DAY_MS) / 60_000);
const isoOf = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);
// 1970-01-01 was a Thursday: day 0 → 4 (0 = Sunday).
const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;

export type Holidays = ReadonlySet<string>; // "YYYY-MM-DD", Malaysia dates

export function isWorkingDay(day: number, holidays: Holidays): boolean {
  const w = weekday(day);
  return w >= 1 && w <= 5 && !holidays.has(isoOf(day));
}

function nextWorkingDay(day: number, holidays: Holidays): number {
  // A year of holidays back to back is impossible; the bound only stops an
  // endless loop on bad data.
  for (let d = day + 1; d < day + 366; d++)
    if (isWorkingDay(d, holidays)) return d;
  throw new Error("no working day within a year: check the holiday table");
}

// The moment counting starts: `at` itself during office hours, otherwise
// the next opening.
export function countFrom(at: Date, holidays: Holidays): Date {
  const day = mytDay(at);
  const min = minutesInto(at);
  if (isWorkingDay(day, holidays) && min >= OPEN_MINUTES && min < CLOSE_MINUTES)
    return at;
  const openDay =
    isWorkingDay(day, holidays) && min < OPEN_MINUTES
      ? day
      : nextWorkingDay(day, holidays);
  return new Date(openDay * DAY_MS - MYT_OFFSET_MS + OPEN_MINUTES * 60_000);
}

export function replyDueAt(at: Date, holidays: Holidays): Date {
  const start = countFrom(at, holidays);
  const day = mytDay(start);
  const due = nextWorkingDay(day, holidays);
  return new Date(start.getTime() + (due - day) * DAY_MS);
}

export function isOfficeHours(at: Date, holidays: Holidays): boolean {
  return countFrom(at, holidays).getTime() === at.getTime();
}
