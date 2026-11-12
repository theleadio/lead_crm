// Home's Free workshops section (12 Nov 2026). Free workshops are not CRM
// classes yet (January, after cutover), and their sign-ups come from the GHL
// import with the Meta campaign name but no campaign id, so a workshop is read
// from the campaign name itself:
//   "LEAD | Nov2026 | Lead | Vibe Coding Masterclass EN 19 Nov"
//    brand   month+year  kind   title                 lang day month
// Only kind "Lead" is a free workshop; "Sales" campaigns sell paid classes.
import { PermissionError, type Viewer } from "../auth/permissions.ts";
import { livePersonSql } from "../reports/ads.ts";
import { db } from "../sql.ts";
import { canSeeLeadCounts } from "./service.ts";
import type { HomeWorkshop } from "./types.ts";

export type WorkshopKey = {
  title: string;
  language: "en" | "zh";
  // YYYY-MM-DD
  date: string;
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

// The campaign's own month and year, e.g. "Nov2026".
const CAMPAIGN_MONTH = /^([a-z]{3})[a-z]*\s*(\d{4})$/i;
// "<title> <EN|CN> <day> <month>", e.g. "Vibe Coding Masterclass EN 19 Nov".
const TITLE_PART = /^(.+?)\s+(en|cn)\s+(\d{1,2})\s*([a-z]{3})[a-z]*\.?$/i;

// null for anything that is not a dated free-workshop campaign, so a stray or
// mistyped name is left out rather than shown as a wrong workshop.
export function parseWorkshopCampaign(name: string): WorkshopKey | null {
  const parts = name.split("|").map((p) => p.trim());
  if (parts.length < 4 || parts[2].toLowerCase() !== "lead") return null;

  const campaign = CAMPAIGN_MONTH.exec(parts[1]);
  const titled = TITLE_PART.exec(parts.slice(3).join(" | "));
  if (!campaign || !titled) return null;

  const campaignMonth = MONTHS.indexOf(campaign[1].toLowerCase());
  const month = MONTHS.indexOf(titled[4].toLowerCase());
  if (campaignMonth < 0 || month < 0) return null;
  const day = Number(titled[3]);
  // A December campaign for a January workshop runs into the next year.
  const year = Number(campaign[2]) + (month < campaignMonth ? 1 : 0);

  const at = new Date(Date.UTC(year, month, day));
  if (at.getUTCMonth() !== month || at.getUTCDate() !== day) return null;

  return {
    title: titled[1].trim(),
    language: titled[2].toLowerCase() === "cn" ? "zh" : "en",
    date: at.toISOString().slice(0, 10),
  };
}

const WINDOW_DAYS = 14;

// Free workshops dated today to 14 days ahead in Kuala Lumpur (§4), the same
// window as Upcoming classes. Campaign spellings that differ only in case
// ("LEAD"/"Lead", "EN"/"En") are one workshop; a person on two of them counts
// once. Sign-ups are counted over all time: each campaign is for one date.
export async function upcomingWorkshops(
  viewer: Viewer,
): Promise<HomeWorkshop[]> {
  if (!canSeeLeadCounts(viewer)) throw new PermissionError("person");
  const sql = db();
  // The pattern only narrows the read; parseWorkshopCampaign decides.
  // shortcut: groups in TypeScript over every lead-campaign touch; move into
  // SQL if lead touches pass ~50k.
  const rows = await sql`
    SELECT DISTINCT t.utm_campaign, t.person_id
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE t.utm_campaign ILIKE '%|%lead%|%' AND ${livePersonSql(sql)}`;

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + WINDOW_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);

  const groups = new Map<
    string,
    {
      key: WorkshopKey;
      people: Set<string>;
      // People per spelling, to show the most-used one.
      titles: Map<string, Set<string>>;
      campaigns: Set<string>;
    }
  >();
  for (const r of rows) {
    const key = parseWorkshopCampaign(r.utm_campaign as string);
    if (!key || key.date < today || key.date > last) continue;
    const id = `${key.title.toLowerCase()}|${key.language}|${key.date}`;
    const g = groups.get(id) ?? {
      key,
      people: new Set(),
      titles: new Map(),
      campaigns: new Set(),
    };
    g.people.add(r.person_id as string);
    g.campaigns.add(r.utm_campaign as string);
    const spelled = g.titles.get(key.title) ?? new Set<string>();
    spelled.add(r.person_id as string);
    g.titles.set(key.title, spelled);
    groups.set(id, g);
  }

  return [...groups.values()]
    .map((g) => ({
      title: [...g.titles].sort((a, b) => b[1].size - a[1].size)[0][0],
      language: g.key.language,
      date: g.key.date,
      signups: g.people.size,
      campaigns: g.campaigns.size,
    }))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
}
