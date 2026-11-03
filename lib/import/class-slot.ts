export type ClassSlot = { start: string; end: string; language: "en" | "zh" | null; city: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b`;
const EN_DATE = new RegExp(String.raw`(\d{1,2})(?:\s*(?:[-–&]|and)\s*(\d{1,2}))?\s+${MONTH_RE}(?:,?\s+(\d{4}))?`, "i");
const ZH_DATE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
// shortcut: fixed city list, add a name here when a new venue city appears
const CITY_RE = /\b(Johor Bahru|Kuala Lumpur|Penang|Ipoh|Kuching|Kota Kinabalu|Singapore)\b/i;

const pad = (n: number) => String(n).padStart(2, "0");
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&");

function dateOf(text: string, cutoff: string): { start: string; end: string; zh: boolean } | null {
  const en = EN_DATE.exec(text);
  const zh = en ? null : ZH_DATE.exec(text);
  if (!en && !zh) return null;
  const [d1, d2, month, year] = en
    ? [+en[1], +(en[2] ?? en[1]), MONTHS.indexOf(en[3].slice(0, 3).toLowerCase()) + 1, en[4]]
    : [+zh![3], +zh![3], +zh![2], zh![1]];
  const build = (y: number) => [`${y}-${pad(month)}-${pad(d1)}`, `${y}-${pad(month)}-${pad(d2)}`];
  let y = year ? +year : +cutoff.slice(0, 4);
  let [start, end] = build(y);
  if (!year && start < cutoff) [start, end] = build(++y);
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
    city: rest.map((t) => CITY_RE.exec(t)?.[1]).find(Boolean) ?? null,
  };
}
