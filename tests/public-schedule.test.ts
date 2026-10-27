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
  languageLabel,
  placeLabel,
  registerControl,
  seatsLabel,
  timeLabel,
  trackLabel,
} from "../app/(public)/schedule/schedule-view.ts";
import { dictionary } from "../app/(public)/dictionaries.ts";

// The words each locale's page renders. The view helpers take a dictionary
// rather than holding one, so these are the two arguments every label test
// needs (website-localisation).
const EN = dictionary("en");
const ZH = dictionary("zh");

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
  for (const p of [
    "/schedule",
    "/enquiry",
    // §10.4's pages, including the one Stripe returns a payer to: a redirect
    // to sign-in there would lose the payment's confirmation.
    "/register",
    "/register/AIA-2611-KL",
    "/register/thank-you",
    // Both locales, or a Chinese page would cost a getUser() round trip and
    // depend on the sign-in provider being reachable (§10.5).
    "/zh/schedule",
    "/zh/enquiry",
    "/zh/register/AIA-2611-KL",
    "/zh/register/thank-you",
    // The bare prefix too, which now redirects to /zh/schedule.
    "/zh",
    "/api/public/schedule",
    "/api/public/leads",
    "/api/public/register",
  ])
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
    // The prefix is a segment, not a string prefix: a CRM page whose path
    // merely starts with the same letters must still be gated. Same for
    // "register" and "schedule".
    "/zhuhai",
    "/registered-interest",
    "/scheduler",
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

// §10.4 shipped, so what a card offers depends on whether a payment can
// complete: `checkoutConfigured(env)` is read by the server page and passed
// in. `live: false` is the state a deployment with no Stripe key is in, and
// every card then asks for an enquiry instead (website-schedule).
test("register control: with no payment provider, every class offers the enquiry link", () => {
  for (const seatsLabel of ["available", "few_seats", "full"] as const)
    assert.deepEqual(registerControl(cls({ seatsLabel }), "en", EN, false), {
      // §10.3: our own form, carrying the class code so the lead's deal is
      // attached to this class.
      href: "/enquiry?class=AIA-2610-EN",
      label: "Enquire",
      reason: null,
    });
  // Never the feed's URL: it names the marketing site, not this app.
  const control = registerControl(cls(), "en", EN, false);
  assert.notEqual(control.href, base.registerUrl);
  // And never the wording that promises a date we cannot name.
  assert.doesNotMatch(control.label, /soon/i);
});

test("register control: the enquiry destination always exists", () => {
  // The disabled "no enquiry URL" branch is gone: the form is a page this
  // app serves, so there is no configuration under which the control leads
  // nowhere. A class code is escaped rather than trusted into the URL.
  const control = registerControl(
    cls({ code: "A&B 2611/EN" }),
    "en",
    EN,
    false,
  );
  assert.equal(control.href, "/enquiry?class=A%26B%202611%2FEN");
  assert.equal(control.reason, null);
});

test("register control: a bookable class links to this app's register page", () => {
  for (const seatsLabel of ["available", "few_seats"] as const) {
    const control = registerControl(cls({ seatsLabel }), "en", EN, true);
    assert.deepEqual(control, {
      href: "/register/AIA-2610-EN",
      label: "Register",
      reason: null,
    });
    // Not the feed's absolute URL: it carries no locale, so a Chinese reader
    // would land on the English page (website-schedule).
    assert.notEqual(control.href, base.registerUrl);
  }
});

test("register control: a full class is disabled and says why", () => {
  const control = registerControl(cls({ seatsLabel: "full" }), "en", EN, true);
  assert.deepEqual(control, {
    href: null,
    label: "Register",
    reason: "This class is full",
  });
});

test("register control: a class with no register URL is disabled, not an empty link", () => {
  // §8.1's field is still the signal for "registration is not reachable at
  // all" — PUBLIC_WEBSITE_URL unset, for instance.
  for (const seatsLabel of ["available", "few_seats"] as const) {
    const control = registerControl(
      cls({ seatsLabel, registerUrl: null }),
      "en",
      EN,
      true,
    );
    assert.equal(control.href, null);
    assert.ok(control.reason);
  }
});

test("register control: both locales, in their own words and their own path", () => {
  const zh = registerControl(cls(), "zh", ZH, true);
  assert.equal(zh.href, "/zh/register/AIA-2610-EN");
  assert.equal(zh.label, ZH["card.register"]);
  assert.notEqual(zh.label, EN["card.register"]);
  // A full class on the Chinese page: the reason is Chinese too.
  const full = registerControl(cls({ seatsLabel: "full" }), "zh", ZH, true);
  assert.equal(full.reason, ZH["card.register.full"]);
  // And a class code is escaped into the path, not trusted into it.
  assert.equal(
    registerControl(cls({ code: "A&B 2611/EN" }), "zh", ZH, true).href,
    "/zh/register/A%26B%202611%2FEN",
  );
});

test("one decision for every card: the flag is read once, on the server", () => {
  const view = readFileSync(
    new URL("../app/(public)/schedule/schedule-view.ts", import.meta.url),
    "utf8",
  );
  // No constant and no environment read in the module the client list
  // imports: the page decides, so no deploy can leave the cards and the
  // route disagreeing (website-register). Comments are stripped first — this
  // file's own prose names `process.env` to say it must not read it.
  const code = view
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /REGISTRATION_LIVE/);
  assert.doesNotMatch(code, /process\.env/);
  const page = readFileSync(
    new URL("../app/(public)/schedule/schedule-page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /checkoutConfigured\(process\.env\)/);
  assert.equal(
    page.match(/checkoutConfigured/g)?.length,
    2,
    "read once, in one place (the import and the call)",
  );
});

test("a class with no time shows the date alone", () => {
  assert.equal(timeLabel(cls({ startTime: null, endTime: null })), null);
  assert.equal(timeLabel(cls()), "09:00 – 17:00");
  assert.equal(timeLabel(cls({ endTime: null })), "09:00");
});

test("an online class shows Online, not an empty venue", () => {
  assert.equal(
    placeLabel(cls({ mode: "online", venueName: null, city: null }), EN),
    "Online",
  );
  assert.equal(placeLabel(cls(), EN), "AI365 Hub, Kuala Lumpur");
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

// The feed options are invisible to the pure-function tests above and quietly
// load-bearing: drop the tag and O38's purge stops reaching this page, drop the
// revalidate and every visitor hits the database.
test("the page's feed is cached five minutes under the tag O38 purges, and asks for §14's full 100", () => {
  const src = readFileSync(
    new URL("../app/(public)/schedule/feed.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /revalidate:\s*300/);
  assert.match(src, /tags:\s*\[\s*"public-schedule"\s*\]/);
  assert.match(src, /limit:\s*100/);
  // No HTTP hop and no key on this side: that is what lets the page prerender
  // at build time, with no server listening.
  assert.doesNotMatch(src, /fetch\(|APP_BASE_URL|PUBLIC_API_KEY/);
});

// Both locales render the same classes with their own words (§10.5,
// website-localisation). What must not move: the course name, the venue, the
// city, the dates and the class's own teaching language.
test("the card's own words are localised and the class's data is not", () => {
  const c = cls({ seatsLabel: "few_seats" });

  assert.equal(seatsLabel(c, EN), "Few seats left");
  assert.notEqual(seatsLabel(c, ZH), seatsLabel(c, EN));
  assert.equal(seatsLabel(c, ZH), ZH["card.seats.few_seats"]);

  assert.equal(EN["card.hrdc"], "HRDC claimable");
  assert.notEqual(ZH["card.hrdc"], EN["card.hrdc"]);

  // An online class's word is copy; a venue and a city are data.
  const online = cls({ mode: "online", venueName: null, city: null });
  assert.notEqual(placeLabel(online, ZH), placeLabel(online, EN));
  assert.equal(placeLabel(c, ZH), placeLabel(c, EN));
});

test("the language badge names the class's language in the page's words", () => {
  // Which class it is does not change; the word for it follows the reader.
  assert.equal(languageLabel("en", EN), "English");
  assert.equal(languageLabel("zh", EN), "中文");
  assert.equal(languageLabel("en", ZH), "英文");
  assert.equal(languageLabel("zh", ZH), "中文");
  // A value the feed could only give us after a schema change is shown as it
  // came rather than guessed at, in either locale.
  assert.equal(languageLabel("ms", EN), "ms");
  assert.equal(languageLabel("ms", ZH), "ms");
});

test("every track has a word in both locales", () => {
  const tracks = [
    "certification",
    "mastery",
    "masterclass",
    "workshop",
    "conference",
    "corporate",
  ];
  for (const track of tracks) {
    assert.ok(trackLabel(track, EN));
    assert.ok(trackLabel(track, ZH));
    assert.notEqual(trackLabel(track, ZH), trackLabel(track, EN));
  }
  // An unknown track is still readable rather than blank.
  assert.equal(trackLabel("bootcamp", ZH), "Bootcamp");
});

test("a card's enquiry control carries its page's locale and the class code", () => {
  assert.equal(
    registerControl(cls(), "zh", ZH, false).href,
    "/zh/enquiry?class=AIA-2610-EN",
  );
  assert.equal(
    registerControl(cls(), "en", EN, false).href,
    "/enquiry?class=AIA-2610-EN",
  );
  // The label is the page's language; the code is not.
  assert.equal(
    registerControl(cls(), "zh", ZH, false).label,
    ZH["card.enquire"],
  );
  assert.notEqual(
    registerControl(cls(), "zh", ZH, false).label,
    registerControl(cls(), "en", EN, false).label,
  );
});

test("the locale does not change which classes are listed or their order", () => {
  // The filter and the feed are locale-blind: the page's language is not a
  // query parameter, and both locales read the one cache entry.
  const set = [
    cls({ id: "a", language: "en" }),
    cls({ id: "b", language: "zh" }),
  ];
  assert.deepEqual(
    filterClasses(set, NO_FILTERS).map((c) => c.id),
    ["a", "b"],
  );
  const src = readFileSync(
    new URL("../app/(public)/schedule/schedule-page.tsx", import.meta.url),
    "utf8",
  );
  // One feed read, with no locale in it.
  assert.match(src, /getSchedule\(\)/);
  assert.doesNotMatch(src, /getSchedule\(\s*[^)]/);
});

test("both locales' route files exist and name each other in their metadata", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const en = read("../app/(public)/(en)/schedule/page.tsx");
  const zh = read("../app/(public)/zh/schedule/page.tsx");

  // Each is canonical for itself and points at the other, so a crawler does
  // not read the pair as duplicates. The block is alternates()' now, tested
  // as a value in tests/public-locale-links.test.ts; what is left for a
  // route file to get wrong is the locale it passes.
  assert.ok(en.includes('alternates("en", "/schedule")'));
  assert.ok(zh.includes('alternates("zh", "/schedule")'));

  // Neither holds a string of its own: the title and description are the
  // dictionary's.
  for (const src of [en, zh]) assert.match(src, /dictionary\("(en|zh)"\)/);
});

test("the schedule page's language filter is not the page's language control", () => {
  // Two different things on one page (website-schedule): the filter picks
  // which classes are listed, the header's control picks which language the
  // page is read in. The filter must not navigate, and the control must not
  // be in the filter bar.
  const list = readFileSync(
    new URL("../app/(public)/schedule/schedule-list.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(list, /LanguageLink|otherLocaleHref|localePath/);
  const chrome = readFileSync(
    new URL("../app/(public)/public-chrome.tsx", import.meta.url),
    "utf8",
  );
  assert.match(chrome, /LanguageLink/);
});
