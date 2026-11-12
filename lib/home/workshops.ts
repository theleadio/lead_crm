// Home's Free workshops section (12 Nov 2026). Free workshops are not CRM
// classes yet (January, after cutover), and their sign-ups come from the GHL
// import with the Meta campaign name but no campaign id, so a workshop is read
// from the campaign name itself:
//   "LEAD | Nov2026 | Lead | Vibe Coding Masterclass EN 19 Nov"
//    brand   month+year  kind   title                 lang day month
// Only kind "Lead" is a free workshop; "Sales" campaigns sell paid classes.

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
