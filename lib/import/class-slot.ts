export type ClassSlot = { start: string; end: string; language: "en" | "zh" | null; city: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b`;
const EN_DATE = new RegExp(String.raw`(\d{1,2})(?:\s*(?:[-–&]|and)\s*(\d{1,2}))?\s+${MONTH_RE}(?:,?\s+(\d{4}))?`, "i");
const CROSS_DATE = new RegExp(String.raw`(\d{1,2})\s+${MONTH_RE}\s*[-–]\s*(\d{1,2})\s+${MONTH_RE}(?:,?\s+(\d{4}))?`, "i");
const ZH_DATE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
const CITY_RE = /\bJohor Bahru\b/i;

const pad = (n: number) => String(n).padStart(2, "0");
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&");
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
// null for a day the calendar does not have (31 November): Postgres would refuse it.
const ymd = (y: number, m: number, d: number) => {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s ? s : null;
};

function dateOf(text: string, cutoff: string): { start: string; end: string; zh: boolean } | null {
  const x = CROSS_DATE.exec(text);
  const en = x ? null : EN_DATE.exec(text);
  const zh = x || en ? null : ZH_DATE.exec(text);
  if (!x && !en && !zh) return null;
  const [d1, m1, d2, m2, year] = x
    ? [+x[1], monthOf(x[2]), +x[3], monthOf(x[4]), x[5]]
    : en
      ? [+en[1], monthOf(en[3]), +(en[2] ?? en[1]), monthOf(en[3]), en[4]]
      : [+zh![3], +zh![2], +zh![3], +zh![2], zh![1]];
  // The year belongs to the end date; a range across New Year starts the year before.
  const build = (y: number) => [ymd(m2 < m1 ? y - 1 : y, m1, d1), ymd(y, m2, d2)];
  let y = year ? +year : +cutoff.slice(0, 4);
  let [start, end] = build(y);
  if (!year && (start ?? "") < cutoff) [start, end] = build(++y);
  // An impossible day or a range that ends before it starts is no date (class CHECK end >= start).
  if (!start || !end || end < start) return null;
  return { start, end, zh: !!zh };
}

const languageOf = (t: string) => (/chinese|中文/i.test(t) ? "zh" : /english/i.test(t) ? "en" : null);

export function parseClassSlot(texts: (string | null | undefined)[], paidAt: Date): ClassSlot | null {
  const cutoff = new Date(paidAt.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const all = texts.map((t) => clean(t ?? ""));
  const i = all.findIndex((t) => dateOf(t, cutoff));
  if (i < 0) return null;
  const d = dateOf(all[i], cutoff)!;
  const rest = all.slice(i); // the dated text first, then later ones
  return {
    start: d.start,
    end: d.end,
    language: rest.map(languageOf).find(Boolean) ?? (d.zh ? "zh" : null),
    city: rest.some((t) => CITY_RE.test(t)) ? "Johor Bahru" : null,
  };
}
