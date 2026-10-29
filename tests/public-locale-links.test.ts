// Every "get in touch" on the public site is built here (§10.3), and the two
// things it must carry together are the locale and the class code. Dropping
// the locale puts a Chinese reader on the English form; dropping the code
// loses what they were asking about. Both are silent in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alternates } from "../app/(public)/alternates.ts";
import { enquiryUrl } from "../app/(public)/enquiry-link.ts";
import {
  LOCALE_LANG,
  localePath,
  otherLocaleHref,
} from "../app/(public)/locale.ts";
import { siteUrl } from "../app/(public)/site-url.ts";

test("the enquiry link carries the locale", () => {
  assert.equal(enquiryUrl("en"), "/enquiry");
  assert.equal(enquiryUrl("zh"), "/zh/enquiry");
});

test("the locale and the class code travel together", () => {
  assert.equal(enquiryUrl("en", "AIA-2611-KL"), "/enquiry?class=AIA-2611-KL");
  assert.equal(
    enquiryUrl("zh", "AIA-2611-KL"),
    "/zh/enquiry?class=AIA-2611-KL",
  );
});

test("an absent, blank or odd code leaves a usable link", () => {
  assert.equal(enquiryUrl("zh", null), "/zh/enquiry");
  assert.equal(enquiryUrl("zh", undefined), "/zh/enquiry");
  assert.equal(enquiryUrl("zh", "   "), "/zh/enquiry");
  assert.equal(
    enquiryUrl("zh", " AIA-2611-KL "),
    "/zh/enquiry?class=AIA-2611-KL",
  );
  // A code is only ever a reference, so it is escaped rather than trusted.
  assert.equal(enquiryUrl("zh", "a&b=c"), "/zh/enquiry?class=a%26b%3Dc");
});

test("an unrecognised locale falls back to English, never to Chinese", () => {
  // The type is the real guard — these two calls do not compile. What is
  // asserted here is the behaviour if one ever slips past it: only "zh"
  // routes a visitor into the Chinese tree, so a bad value costs them a
  // translation rather than dropping them on a page they cannot read.
  // @ts-expect-error — the locale is required.
  assert.equal(enquiryUrl(), "/enquiry");
  // @ts-expect-error — "ms" is not a locale this site serves.
  assert.equal(enquiryUrl("ms", "AIA-2611-KL"), "/enquiry?class=AIA-2611-KL");
});

// §10.4's pages. The register link has to carry the same two things as the
// enquiry link, and the thank-you pair has to exist in both locales, or a
// Chinese payer comes back to an English page after paying.
test("the register page's path carries the locale and the class code", () => {
  for (const [locale, want] of [
    ["en", "/register/AIA-2611-KL"],
    ["zh", "/zh/register/AIA-2611-KL"],
  ] as const)
    assert.equal(
      localePath(locale, `/register/${encodeURIComponent("AIA-2611-KL")}`),
      want,
    );
  // A code is escaped into the path, not trusted into it.
  assert.equal(
    localePath("zh", `/register/${encodeURIComponent("a&b c")}`),
    "/zh/register/a%26b%20c",
  );
});

test("the language control keeps the class and the campaign on a register page", () => {
  // A visitor who switches language half-way through a booking keeps both the
  // class they were booking and the campaign that found them (§10.2).
  assert.equal(
    otherLocaleHref("en", "/register/AIA-2611-KL", "?utm_source=fb"),
    "/zh/register/AIA-2611-KL?utm_source=fb",
  );
  assert.equal(
    otherLocaleHref("zh", "/zh/register/AIA-2611-KL", "?utm_source=fb"),
    "/register/AIA-2611-KL?utm_source=fb",
  );
  // And on the thank-you page, where the query is Stripe's session id.
  assert.equal(
    otherLocaleHref("zh", "/zh/register/thank-you", "?session_id=cs_1"),
    "/register/thank-you?session_id=cs_1",
  );
});

test("every public route declares its alternates, with its own locale", () => {
  const read = (p: string) =>
    readFileSync(new URL(`../app/(public)/${p}`, import.meta.url), "utf8");
  // What the alternates themselves say is checked against alternates() below.
  // All a route file can get wrong is which locale and which path it passes —
  // a Chinese page calling alternates("en", …) would claim the English URL as
  // its own canonical and hand the pair to a crawler as duplicates.
  for (const [file, call] of [
    ["(en)/schedule/page.tsx", 'alternates("en", "/schedule")'],
    ["zh/schedule/page.tsx", 'alternates("zh", "/schedule")'],
    ["(en)/enquiry/page.tsx", 'alternates("en", "/enquiry")'],
    ["zh/enquiry/page.tsx", 'alternates("zh", "/enquiry")'],
    ["(en)/register/[classCode]/page.tsx", 'alternates("en", path)'],
    ["zh/register/[classCode]/page.tsx", 'alternates("zh", path)'],
    [
      "(en)/register/thank-you/page.tsx",
      'alternates("en", "/register/thank-you")',
    ],
    [
      "zh/register/thank-you/page.tsx",
      'alternates("zh", "/register/thank-you")',
    ],
  ] as const)
    assert.ok(read(file).includes(call), `${file} should call ${call}`);

  // The thank-you page is not worth indexing and its URL carries a session id.
  for (const file of [
    "(en)/register/thank-you/page.tsx",
    "zh/register/thank-you/page.tsx",
  ])
    assert.match(read(file), /robots: \{ index: false/);
});

// ---- canonical, hreflang and <html lang> ----------------------------------

test("each locale is its own canonical and names the other, plus x-default", () => {
  // Written out per route file this was eight object literals and a regex over
  // the source; a crossed or missing entry is the kind of mistake that only
  // shows up in a crawler's index weeks later.
  assert.deepEqual(alternates("en", "/schedule"), {
    canonical: "/schedule",
    languages: {
      "x-default": "/schedule",
      en: "/schedule",
      zh: "/zh/schedule",
    },
  });
  // The Chinese page claims its own URL and still points at both.
  assert.deepEqual(alternates("zh", "/schedule"), {
    canonical: "/zh/schedule",
    languages: {
      "x-default": "/schedule",
      en: "/schedule",
      zh: "/zh/schedule",
    },
  });
  // x-default is the English path, which is the unprefixed canonical one and
  // the page a searcher with neither language can read.
  for (const locale of ["en", "zh"] as const) {
    const a = alternates(locale, "/register/AIA-2611-KL");
    assert.equal(a.languages["x-default"], "/register/AIA-2611-KL");
    assert.equal(a.languages.en, a.languages["x-default"]);
    assert.equal(a.languages.zh, "/zh/register/AIA-2611-KL");
  }
});

test("<html lang> is the page's own language, set by a root layout per locale", () => {
  const read = (p: string) =>
    readFileSync(new URL(`../app/${p}`, import.meta.url), "utf8");

  // §14 requires WCAG 2.1 AA and 3.1.1 (Language of Page, Level A) is met
  // through the html element. The only way two trees can disagree about it is
  // a root layout each, which means no app/layout.tsx above them.
  assert.throws(
    () => read("layout.tsx"),
    /ENOENT/,
    "app/layout.tsx would wrap both locales in one <html lang>",
  );

  // The shell writes it, and each locale's root layout chooses the locale.
  const root = read("(public)/public-root.tsx");
  assert.match(root, /<html\s[\s\S]*?lang=\{LOCALE_LANG\[locale\]\}/);
  assert.match(root, /<body/, "a root layout owns <html> and <body>");
  assert.match(read("(public)/(en)/layout.tsx"), /PublicRoot locale="en"/);
  assert.match(read("(public)/zh/layout.tsx"), /PublicRoot locale="zh"/);

  // zh-Hans rather than zh: a screen reader picks its voice from the script.
  assert.equal(LOCALE_LANG.en, "en");
  assert.equal(LOCALE_LANG.zh, "zh-Hans");

  // The CRM keeps a root of its own, so its lang is a statement about its own
  // screens rather than a default the public pages inherit.
  assert.match(read("(app)/layout.tsx"), /<html\s[\s\S]*?lang="en"/);
});

test("/zh is a page, not a 404", () => {
  // A visitor who shortens the URL by hand, or a crawler that trims the /zh
  // hreflang, used to get a 404. There is no Chinese landing page, so this
  // goes to the schedule.
  const src = readFileSync(
    new URL("../app/(public)/zh/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /redirect\("\/zh\/schedule"\)/);
  assert.match(src, /from "next\/navigation"/);
});

test("siteUrl reads APP_BASE_URL, and says so when it cannot be used", () => {
  assert.equal(siteUrl({}), null, "unset leaves the links relative");
  assert.equal(siteUrl({ APP_BASE_URL: "   " }), null);
  assert.equal(siteUrl({ APP_BASE_URL: "not a url" }), null);
  assert.equal(
    siteUrl({ APP_BASE_URL: " https://crm.example/ " })?.origin,
    "https://crm.example",
  );

  // A loopback base in production points every canonical and hreflang link at
  // a machine no crawler can reach, and the pages still render, so nothing
  // else would report it. The URL is still returned — the address is the
  // deployment's mistake to fix, not ours to swallow.
  const said: string[] = [];
  const realError = console.error;
  console.error = (m: unknown) => void said.push(String(m));
  try {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      said.length = 0;
      const url = siteUrl({
        APP_BASE_URL: `http://${host}`,
        NODE_ENV: "production",
      });
      assert.equal(url?.origin, `http://${host}`);
      assert.equal(said.length, 1, `${host} should be reported`);
      assert.match(said[0], /local address in production/);
    }
    // Not in development, where localhost is the whole point.
    said.length = 0;
    siteUrl({ APP_BASE_URL: "http://localhost:3000", NODE_ENV: "development" });
    assert.deepEqual(said, []);
  } finally {
    console.error = realError;
  }
});
