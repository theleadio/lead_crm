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
  assert.equal(labels.get("111"), "Claude Code KL · Sales · Oct 2026");
  assert.equal(labels.get("222"), "Claude Code KL · Sales · Nov 2026");
});

test("campaignLabels: a month they share is left out; the id's last four tell them apart", () => {
  const labels = campaignLabels(
    new Map([
      ["120001111", "LEAD | Oct2026 | Sales | Claude Code KL"],
      ["120002222", "LEAD | Oct2026 | Sales | Claude Code KL"],
      ["120003333", "Plain name"],
      ["120004444", "Plain name"],
    ]),
  );
  assert.equal(labels.get("120001111"), "Claude Code KL · Sales · …1111");
  assert.equal(labels.get("120002222"), "Claude Code KL · Sales · …2222");
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
  assert.equal(labels.get("1001"), "X · Sales · …1001");
  assert.equal(labels.get("1002"), "X · Sales · …1002");
  assert.equal(labels.get("1003"), "X · Sales · Nov 2026");
});

test("campaignLabels: names that differ only in case still clash", () => {
  const labels = campaignLabels(
    new Map([
      ["90001234", "LEAD | Oct2026 | Sales | Ai Engineering 17 18 Oct"],
      ["90005678", "LEAD | Oct2026 | Sales | AI Engineering 17 18 Oct"],
    ]),
  );
  assert.equal(
    labels.get("90001234"),
    "Ai Engineering 17 18 Oct · Sales · …1234",
  );
  assert.equal(
    labels.get("90005678"),
    "AI Engineering 17 18 Oct · Sales · …5678",
  );
});

test("campaignLabels: a month spelled out longer still counts (July2026)", () => {
  const labels = campaignLabels(
    new Map([
      ["6983452496397", "LEAD | July2026 | Leads | AI Engineering Webinar"],
      ["6944330008397", "Lead | June2026 | Leads | Ai Engineering Webinar"],
    ]),
  );
  assert.equal(
    labels.get("6983452496397"),
    "AI Engineering Webinar · Leads · July 2026",
  );
  assert.equal(
    labels.get("6944330008397"),
    "Ai Engineering Webinar · Leads · June 2026",
  );
});

test("campaignLabels: the objective is spelled one way whatever the name typed", () => {
  const labels = campaignLabels(
    new Map([
      ["1", "LEAD | Oct2026 | Whatsapp | AI Automation EN 11-12 Nov"],
      ["2", "LEAD | Oct2026 | SALES | Claude EN 1 Nov"],
      ["3", "LEAD | Oct2026 | Lead | Vibe Coding Masterclass EN 18 Nov"],
    ]),
  );
  assert.equal(labels.get("1"), "AI Automation EN 11-12 Nov · WhatsApp");
  assert.equal(labels.get("2"), "Claude EN 1 Nov · Sales");
  assert.equal(labels.get("3"), "Vibe Coding Masterclass EN 18 Nov · Leads");
});
