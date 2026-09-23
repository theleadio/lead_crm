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
