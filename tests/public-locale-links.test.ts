// Every "get in touch" on the public site is built here (§10.3), and the two
// things it must carry together are the locale and the class code. Dropping
// the locale puts a Chinese reader on the English form; dropping the code
// loses what they were asking about. Both are silent in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enquiryUrl } from "../app/(public)/enquiry-link.ts";

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
