const TIME_ZONE = "Asia/Kuala_Lumpur";

// Spec §4: dates always rendered in Asia/Kuala_Lumpur.
// Date format: DD MMM YYYY (22 Sep 2026).
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  // en-US gives 3-letter month abbreviations (en-GB abbreviates
  // September as "Sept"); reorder its parts to DD MMM YYYY.
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).formatToParts(d);

  const day = parts.find((p) => p.type === "day")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const year = parts.find((p) => p.type === "year")!.value;

  return `${day} ${month} ${year}`;
}

// Time format: h:mma (9:00am) — no leading zero on hour, no space before am/pm.
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TIME_ZONE,
  }).formatToParts(d);

  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  const dayPeriod = parts
    .find((p) => p.type === "dayPeriod")!
    .value.toLowerCase()
    .replace(/\./g, "");

  return `${hour}:${minute}${dayPeriod}`;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Spec §9.0 Home, overdue tasks: how late a task is, in the largest unit
// that still reads honestly ("2 days late", "5 hours late"). Anything under
// an hour is "due now" rather than "0 hours late".
// A timestamp that has to be exact to the minute — a reservation deadline
// (§12.1) rather than a day on a calendar.
export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)}, ${formatTime(date)}`;
}

export function formatOverdue(
  dueAt: Date | string,
  now: Date = new Date(),
): string {
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const diff = now.getTime() - d.getTime();
  if (Number.isNaN(diff) || diff < HOUR) return "due now";
  const days = Math.floor(diff / DAY);
  if (days >= 1) return `${days} ${days === 1 ? "day" : "days"} late`;
  const hours = Math.floor(diff / HOUR);
  return `${hours} ${hours === 1 ? "hour" : "hours"} late`;
}

// Spec §9.1 Last activity: relative under 7 days ("3 days ago"), absolute
// after ("14 Aug 2026"), "—" when there is none — never "Invalid date".
export function formatLastActivity(
  date: Date | string | null,
  now: Date = new Date(),
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";

  const diff = now.getTime() - d.getTime();
  if (diff >= 7 * DAY) return formatDate(d);

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < HOUR) return "just now";
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour");
  return rtf.format(-Math.floor(diff / DAY), "day");
}

// Spec §9.8 / §9.0 class dates: one date for a single-day class, otherwise
// the range with the month and year said once ("06 – 07 Oct 2026"). Takes
// plain ISO dates (YYYY-MM-DD) — they carry no time, so they are read as UTC
// midnight and rendered as that calendar day (§4).
export function formatDateRange(startDate: string, endDate: string): string {
  const end = formatDate(`${endDate}T00:00:00Z`);
  if (startDate === endDate) return end;
  const start = formatDate(`${startDate}T00:00:00Z`);
  // Same month and year: say the day twice, the rest once.
  return start.slice(3) === end.slice(3)
    ? `${start.slice(0, 2)} – ${end}`
    : `${start} – ${end}`;
}
