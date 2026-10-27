// Every "get in touch" on the public site is built here (§10.3), and the two
// things it must carry together are the locale and the class code. Dropping
// the locale puts a Chinese reader on the English form; dropping the code
// loses what they were asking about. Both are silent in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enquiryUrl } from "../app/(public)/enquiry-link.ts";
import { localePath, otherLocaleHref } from "../app/(public)/locale.ts";

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

test("both locales serve both register pages, and each names the other", () => {
  const read = (p: string) =>
    readFileSync(new URL(`../app/(public)/${p}`, import.meta.url), "utf8");
  for (const [file, canonical] of [
    ["(en)/register/[classCode]/page.tsx", "/register/"],
    ["zh/register/[classCode]/page.tsx", "/zh/"],
    ["(en)/register/thank-you/page.tsx", '"/register/thank-you"'],
    ["zh/register/thank-you/page.tsx", '"/zh/register/thank-you"'],
  ] as const) {
    const src = read(file);
    assert.match(src, /alternates/, `${file} declares its alternates`);
    assert.ok(src.includes(canonical), `${file} names its own canonical`);
    // Each page names both languages, so neither is a dead end for a crawler.
    assert.match(src, /languages/);
    assert.match(src, /zh:/);
    assert.match(src, /en:/);
  }
  // The thank-you page is not worth indexing and its URL carries a session id.
  for (const file of [
    "(en)/register/thank-you/page.tsx",
    "zh/register/thank-you/page.tsx",
  ])
    assert.match(read(file), /robots: \{ index: false/);
});
