// §9.18: two campaigns never read as one label anywhere on the ads screen
// (browser check, 11 Nov: two "Claude ..." bars at 6.9× and 0.6×).
import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignLabels } from "../app/(app)/(crm)/reports/ads/panels/campaign-label.ts";

test("campaignLabels: a label nobody shares is left as campaignLabel cut it", () => {
  const labels = campaignLabels(
    new Map([
      ["111", "LEAD | Oct2026 | Sales | AI Vibe Coding 23 Oct KL"],
      ["222", "LEAD | Oct2026 | Sales | Claude Code 30 Oct KL"],
    ]),
  );
  assert.equal(labels.get("111"), "AI Vibe Coding 23 Oct KL · Sales");
  assert.equal(labels.get("222"), "Claude Code 30 Oct KL · Sales");
});

test("campaignLabels: a shared label gets each campaign's month", () => {
  const labels = campaignLabels(
    new Map([
      ["111", "LEAD | Oct2026 | Sales | Claude Code KL"],
      ["222", "LEAD | Nov2026 | Sales | Claude Code KL"],
    ]),
  );
  assert.equal(labels.get("111"), "Claude Code KL · Sales · Oct2026");
  assert.equal(labels.get("222"), "Claude Code KL · Sales · Nov2026");
});

test("campaignLabels: same month, or no month, falls back to the id's last four", () => {
  const labels = campaignLabels(
    new Map([
      ["120001111", "LEAD | Oct2026 | Sales | Claude Code KL"],
      ["120002222", "LEAD | Oct2026 | Sales | Claude Code KL"],
      ["120003333", "Plain name"],
      ["120004444", "Plain name"],
    ]),
  );
  assert.equal(
    labels.get("120001111"),
    "Claude Code KL · Sales · Oct2026 · …1111",
  );
  assert.equal(
    labels.get("120002222"),
    "Claude Code KL · Sales · Oct2026 · …2222",
  );
  assert.equal(labels.get("120003333"), "Plain name · …3333");
  assert.equal(labels.get("120004444"), "Plain name · …4444");
});

test("campaignLabels: every label on the screen is distinct", () => {
  const labels = campaignLabels(
    new Map([
      ["1001", "LEAD | Oct2026 | Sales | X"],
      ["1002", "LEAD | Oct2026 | Sales | X"],
      ["1003", "LEAD | Nov2026 | Sales | X"],
    ]),
  );
  assert.equal(new Set(labels.values()).size, 3);
});
