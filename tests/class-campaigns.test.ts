// Which Meta campaigns the class page suggests for a class (12 Nov). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestsClass } from "../lib/classes/campaigns.ts";

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
