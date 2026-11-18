// GHL registration forms -> free workshops and touchpoints (12 Nov). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkshopForm,
  planFormTouchpoints,
} from "../lib/import/ghl-forms.ts";

test("an English registration form gives title, language and date", () => {
  assert.deepEqual(
    parseWorkshopForm(".02 LEAD - AI Vibe Coding Masterclass 18 Nov 2026"),
    { title: "AI Vibe Coding Masterclass", language: "en", date: "2026-11-18" },
  );
});

test("a Chinese form is zh, and the dash before the date is dropped", () => {
  assert.deepEqual(
    parseWorkshopForm(
      ".02 LEAD - AI Vibe Coding 氛围编程讲座表格 - 12 Nov 2026",
    ),
    {
      title: "AI Vibe Coding 氛围编程讲座表格",
      language: "zh",
      date: "2026-11-12",
    },
  );
});

test("forms without a date are not workshops", () => {
  for (const name of [
    ".03 LEAD - EN - AI Engineering Interest Form",
    "LEAD Programme Signup Form",
    "Form 21",
    "",
  ])
    assert.equal(parseWorkshopForm(name), null, name);
});

test("an impossible date is skipped", () => {
  assert.equal(parseWorkshopForm(".02 LEAD - X 31 Feb 2026"), null);
});

const WORKSHOP = {
  id: "f1",
  name: ".02 LEAD - AI Vibe Coding Masterclass 18 Nov 2026",
};
const INTEREST = {
  id: "f2",
  name: ".03 LEAD - EN - AI Engineering Interest Form",
};
const sub = (id: string, contactId: string) => ({
  id,
  contactId,
  createdAt: "2026-11-08T03:04:05.000Z",
});

test("each submission of a workshop form becomes one touchpoint on its person", () => {
  const { rows, stats } = planFormTouchpoints(
    [WORKSHOP, INTEREST],
    new Map([
      [
        "f1",
        [sub("s1", "c1"), sub("s2", "c2"), sub("s3", "c9"), sub("s4", "c1")],
      ],
      ["f2", [sub("s5", "c1")]],
    ]),
    new Map([
      ["c1", "person-1"],
      ["c2", "person-2"],
    ]),
    new Set(["ghl-form:s2"]),
  );
  assert.deepEqual(rows, [
    {
      person_id: "person-1",
      channel: "import",
      form_name: WORKSHOP.name,
      occurred_at: "2026-11-08T03:04:05.000Z",
      is_first_touch: false,
      external_ref: "ghl-form:s1",
    },
    {
      person_id: "person-1",
      channel: "import",
      form_name: WORKSHOP.name,
      occurred_at: "2026-11-08T03:04:05.000Z",
      is_first_touch: false,
      external_ref: "ghl-form:s4",
    },
  ]);
  assert.equal(stats["workshop forms"], 1);
  assert.equal(stats["submissions read"], 4);
  assert.equal(stats["skip: already imported"], 1);
  assert.equal(stats["skip: contact not in this CRM"], 1);
  assert.equal(stats["touchpoints"], 2);
});
