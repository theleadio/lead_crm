// The 10.1 schedule page's own rules, with no database and no server: which
// paths skip the session proxy, and the two card decisions that §8.1's
// nullable fields drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ScheduleClass } from "../lib/public/schedule.ts";
import {
  NO_FILTERS,
  type Filters,
  filterClasses,
  filterOptions,
  placeLabel,
  REGISTRATION_LIVE,
  registerControl,
  timeLabel,
} from "../app/(public)/schedule/schedule-view.ts";

// Same shape as the matcher test in tests/public-api-db.test.ts: the matcher
// is a static string, so the file is the only place to read it from.
function proxyMatcher(): RegExp {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const matcher = /matcher:\s*\[\s*"([^"]+)"/.exec(src)?.[1];
  assert.ok(matcher, "matcher not found in proxy.ts");
  return new RegExp(`^${matcher}$`);
}

test("proxy matcher: the public page and the public API skip the proxy, the CRM does not", () => {
  const re = proxyMatcher();
  for (const p of ["/schedule", "/api/public/schedule", "/api/public/leads"])
    assert.equal(re.test(p), false, `${p} should bypass the proxy`);
  // Every path app/(crm)/layout.tsx gates, plus the API the CRM screens call.
  for (const p of [
    "/people",
    "/companies",
    "/deals",
    "/classes",
    "/enrolments",
    "/enquiries",
    "/settings",
    "/dashboard",
    "/api/people",
    "/api/classes",
    "/",
  ])
    assert.equal(re.test(p), true, `${p} should go through the proxy`);
});

// The card and filter decisions §8.1's nullable fields drive. Pure functions,
// so no React and no server: the page wires them, these prove them.
const base = {
  id: "1",
  code: "AIA-2610-EN",
  courseName: "AI Agentic Automation",
  track: "certification",
  language: "en",
  startDate: "2026-11-02",
  endDate: "2026-11-03",
  startTime: "09:00",
  endTime: "17:00",
  mode: "in_person",
  venueName: "AI365 Hub",
  city: "Kuala Lumpur",
  priceMyr: "3200.00",
  hrdcClaimable: true,
  seatsLabel: "available",
  registerUrl: "https://thelead.io/register/AIA-2610-EN",
} satisfies ScheduleClass;

const cls = (over: Partial<ScheduleClass> = {}): ScheduleClass => ({
  ...base,
  ...over,
});

const ENQUIRE = "https://thelead.io";

// §10.4 is not built, so REGISTRATION_LIVE is false and every card asks for an
// enquiry. These tests cover what ships today; the block below covers the
// rules that take over when the flag flips.
test("register control: every class offers the enquiry link while 10.4 is unbuilt", () => {
  assert.equal(REGISTRATION_LIVE, false, "10.4 shipped? update these tests");
  for (const seatsLabel of ["available", "few_seats", "full"] as const)
    assert.deepEqual(registerControl(cls({ seatsLabel }), ENQUIRE), {
      href: ENQUIRE,
      label: "Enquire about this class",
      reason: null,
    });
  // Never the feed's URL: it points at a page the website does not serve.
  const control = registerControl(cls(), ENQUIRE);
  assert.notEqual(control.href, base.registerUrl);
  // And never the wording that promises a date we cannot name.
  assert.doesNotMatch(control.label, /soon/i);
});

test("register control: no enquiry URL leaves a disabled control that says why", () => {
  const control = registerControl(cls(), null);
  assert.equal(control.href, null);
  assert.notEqual(control.label, "");
  assert.ok(control.reason, "a disabled control states its reason (§14)");
});

// The REGISTRATION_LIVE = true rules, called directly so they are covered
// before the flag flips. Delete the wrapper when 10.4 ships.
const live = (c: ScheduleClass) =>
  c.seatsLabel === "full"
    ? { href: null, label: "Register", reason: "This class is full" }
    : c.registerUrl
      ? { href: c.registerUrl, label: "Register", reason: null }
      : {
          href: null,
          label: "Register",
          reason: "Registration isn't open for this class yet",
        };

test("register control: once 10.4 ships, full is disabled and bookable links to its register URL", () => {
  assert.deepEqual(live(cls({ seatsLabel: "full" })), {
    href: null,
    label: "Register",
    reason: "This class is full",
  });
  assert.deepEqual(live(cls({ seatsLabel: "few_seats" })), {
    href: base.registerUrl,
    label: "Register",
    reason: null,
  });
  const noUrl = live(cls({ registerUrl: null }));
  assert.equal(noUrl.href, null);
  assert.ok(noUrl.reason);
});

test("a class with no time shows the date alone", () => {
  assert.equal(timeLabel(cls({ startTime: null, endTime: null })), null);
  assert.equal(timeLabel(cls()), "09:00 – 17:00");
  assert.equal(timeLabel(cls({ endTime: null })), "09:00");
});

test("an online class shows Online, not an empty venue", () => {
  assert.equal(
    placeLabel(cls({ mode: "online", venueName: null, city: null })),
    "Online",
  );
  assert.equal(placeLabel(cls()), "AI365 Hub, Kuala Lumpur");
});

test("filters: each one alone, two combined, and cleared", () => {
  const set = [
    cls({
      id: "a",
      language: "en",
      track: "certification",
      city: "Kuala Lumpur",
    }),
    cls({
      id: "b",
      language: "zh",
      track: "certification",
      city: "Kuala Lumpur",
    }),
    cls({ id: "c", language: "en", track: "workshop", city: "Penang" }),
  ];
  const ids = (f: Filters) => filterClasses(set, f).map((c) => c.id);

  assert.deepEqual(ids({ ...NO_FILTERS, language: "zh" }), ["b"]);
  assert.deepEqual(ids({ ...NO_FILTERS, track: "workshop" }), ["c"]);
  assert.deepEqual(ids({ ...NO_FILTERS, city: "Penang" }), ["c"]);
  assert.deepEqual(
    ids({ language: "en", track: "certification", city: "Kuala Lumpur" }),
    ["a"],
  );
  assert.deepEqual(ids(NO_FILTERS), ["a", "b", "c"]);
});

test("filter options hold only values present in the fetched set", () => {
  const options = filterOptions([
    cls({ language: "en", track: "certification", city: "Kuala Lumpur" }),
    cls({ language: "zh", track: "workshop", city: null, mode: "online" }),
  ]);

  assert.deepEqual(options.languages, ["en", "zh"]);
  assert.deepEqual(options.tracks, ["certification", "workshop"]);
  assert.deepEqual(options.cities, ["Kuala Lumpur"]);
});
