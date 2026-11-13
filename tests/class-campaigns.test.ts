// Which Meta campaigns the class page suggests for a class (12 Nov). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sharesCourseWord, suggestsClass } from "../lib/classes/campaigns.ts";

test("a campaign naming the class's start day and month is suggested", () => {
  assert.equal(
    suggestsClass(
      "LEAD | Oct2026 | WhatsApp | AI Full-Stack CN 14-15 Nov KL",
      "2026-11-14",
    ),
    true,
  );
  assert.equal(
    suggestsClass(
      "LEAD | Nov2026 | Sales | AI 全栈开发课程 14 Nov",
      "2026-11-14",
    ),
    true,
  );
  assert.equal(
    suggestsClass(
      "LEAD | Nov2026 | Sales | Claude AI实战课 CN 28Nov",
      "2026-11-28",
    ),
    true,
  );
});

test("the campaign's own month tag does not count, nor a different day", () => {
  // "Nov2026" is when the campaign was made, not the class date.
  assert.equal(
    suggestsClass(
      "LEAD | Nov2026 | Traffic | AI Engineering 9 Dec",
      "2026-11-09",
    ),
    false,
  );
  assert.equal(
    suggestsClass(
      "LEAD | Oct2026 | Sales | AI Automation 11 Nov",
      "2026-11-14",
    ),
    false,
  );
  assert.equal(
    suggestsClass(
      "LEAD | Oct2026 | Sales | AI Automation 114 Nov",
      "2026-11-14",
    ),
    false,
  );
  assert.equal(
    suggestsClass("Market Update | Oct 8 | Lead Form", "2026-10-08"),
    false,
  );
});

// Auto-link (12 Nov): besides the date, the campaign must name the course.
test("a campaign sharing a real word with the course matches", () => {
  assert.equal(
    sharesCourseWord(
      "LEAD | Oct2026 | Whatsapp | AI Automation EN 11-12 Nov",
      "AI Agentic Automation Certification",
      "ai-automation-11-12-Nov",
    ),
    true,
  );
  assert.equal(
    sharesCourseWord(
      "LEAD | Oct2026 | WhatsApp | AI Full-Stack CN 14-15 Nov KL",
      "AI Full-Stack Building Certification",
      "full-stack-building-14-15-Nov",
    ),
    true,
  );
});

test("another course on the same date, or only generic words, do not match", () => {
  assert.equal(
    sharesCourseWord(
      "LEAD | Nov2026 | Sales | AI 全栈开发课程 11 Nov",
      "AI Agentic Automation Certification",
      "ai-automation-11-12-Nov",
    ),
    false,
  );
  assert.equal(
    sharesCourseWord(
      "LEAD | Nov2026 | Sales | AI Mastery Workshop EN 11 Nov",
      "Claude AI Mastery",
      "claude-ai-mastery-11-Nov",
    ),
    false,
  );
});

test("a course word that only starts like a month still matches", () => {
  assert.equal(
    sharesCourseWord(
      "LEAD | Nov2026 | Sales | AI Marketing EN 11 Nov",
      "AI for Marketing",
      "ai-marketing-11-Nov",
    ),
    true,
  );
});

// Review (12 Nov): the month must be a whole word, so "Marketing", "Augmented",
// "Junior", "Decision" or "Novice" never read as a month.
test("a word that starts like a month is not the class's month", () => {
  for (const [name, start] of [
    ["LEAD | Nov2026 | Sales | AI Marketing EN 11 Nov", "2027-03-11"],
    ["LEAD | Nov2026 | Sales | AI Augmented Coding 5 Nov", "2027-08-05"],
    ["LEAD | Nov2026 | Sales | Junior Coders 6 Dec", "2027-06-06"],
    ["LEAD | Nov2026 | Sales | Decision AI 3 Nov", "2026-12-03"],
    ["LEAD | Nov2026 | Sales | Novice Python 7 Dec", "2026-11-07"],
  ])
    assert.equal(suggestsClass(name, start), false, name);
  assert.equal(
    suggestsClass(
      "LEAD | Nov2026 | Sales | AI Engineering 9 December",
      "2026-12-09",
    ),
    true,
  );
});
