// Reading a free workshop from its "| Lead |" Meta campaign name (Home,
// 12 Nov). Pure: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkshopCampaign } from "../lib/home/workshops.ts";

test("a lead campaign gives title, language and date", () => {
  assert.deepEqual(
    parseWorkshopCampaign(
      "LEAD | Nov2026 | Lead | Vibe Coding Masterclass EN 19 Nov",
    ),
    { title: "Vibe Coding Masterclass", language: "en", date: "2026-11-19" },
  );
});

test("spelling case does not matter, and CN is Chinese", () => {
  assert.deepEqual(
    parseWorkshopCampaign(
      "Lead | Nov2026 | Lead | Vibe Coding Masterclass Cn 12 Nov",
    ),
    { title: "Vibe Coding Masterclass", language: "zh", date: "2026-11-12" },
  );
});

test("a December campaign for a January workshop is next year", () => {
  assert.equal(
    parseWorkshopCampaign("LEAD | Dec2026 | Lead | AI Night EN 5 Jan")?.date,
    "2027-01-05",
  );
});

test("paid and malformed campaigns are not workshops", () => {
  for (const name of [
    "LEAD | Oct2026 | Sales | AI Automation 11 Nov",
    "Lead",
    "",
    "LEAD | Nov2026 | Lead | Masterclass",
  ])
    assert.equal(parseWorkshopCampaign(name), null, name);
});

test("an impossible date is skipped", () => {
  assert.equal(
    parseWorkshopCampaign("LEAD | Feb2026 | Lead | X EN 31 Feb"),
    null,
  );
});
