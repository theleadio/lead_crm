// The URL arithmetic behind the language control (§10.5). Worth its own test
// because the two things it must never lose — the path and the query string —
// are exactly what carries a visitor's class and their campaign (§10.2), and
// losing either is silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localePath,
  otherLocale,
  otherLocaleHref,
  stripLocale,
} from "../app/(public)/locale.ts";

test("English keeps the plain path, Chinese gets the prefix", () => {
  assert.equal(localePath("en", "/schedule"), "/schedule");
  assert.equal(localePath("zh", "/schedule"), "/zh/schedule");
  assert.equal(localePath("en", "/"), "/");
  assert.equal(localePath("zh", "/"), "/zh");
  // A path given without its leading slash is still a path.
  assert.equal(localePath("zh", "schedule"), "/zh/schedule");
});

test("stripLocale returns the English path", () => {
  assert.equal(stripLocale("zh", "/zh/schedule"), "/schedule");
  assert.equal(stripLocale("zh", "/zh"), "/");
  assert.equal(stripLocale("en", "/schedule"), "/schedule");
  // Not re-rooted when the prefix is absent: en paths pass through whole,
  // including one that merely starts with the same letters.
  assert.equal(stripLocale("en", "/zh/schedule"), "/zh/schedule");
  assert.equal(stripLocale("zh", "/zhuhai"), "/zhuhai");
});

test("the switch swaps the locale and keeps the path", () => {
  assert.equal(otherLocaleHref("en", "/schedule"), "/zh/schedule");
  assert.equal(otherLocaleHref("zh", "/zh/schedule"), "/schedule");
  assert.equal(otherLocaleHref("en", "/enquiry"), "/zh/enquiry");
  assert.equal(otherLocaleHref("zh", "/zh/enquiry"), "/enquiry");
  assert.equal(otherLocaleHref("en", "/"), "/zh");
  assert.equal(otherLocaleHref("zh", "/zh"), "/");
});

test("the switch keeps the query string whole", () => {
  assert.equal(
    otherLocaleHref("en", "/enquiry", "?class=AIA-2611-KL&utm_source=fb"),
    "/zh/enquiry?class=AIA-2611-KL&utm_source=fb",
  );
  assert.equal(
    otherLocaleHref("zh", "/zh/enquiry", "class=AIA-2611-KL"),
    "/enquiry?class=AIA-2611-KL",
  );
  // An empty or bare-"?" search adds nothing.
  assert.equal(otherLocaleHref("en", "/schedule", ""), "/zh/schedule");
  assert.equal(otherLocaleHref("en", "/schedule", "?"), "/zh/schedule");
});

test("a trailing slash and a nested path survive the swap", () => {
  assert.equal(otherLocaleHref("en", "/schedule/"), "/zh/schedule/");
  assert.equal(otherLocaleHref("zh", "/zh/schedule/"), "/schedule/");
  assert.equal(otherLocaleHref("en", "/a/b/c"), "/zh/a/b/c");
  assert.equal(otherLocaleHref("zh", "/zh/a/b/c"), "/a/b/c");
});

test("the other locale is the other one", () => {
  assert.equal(otherLocale("en"), "zh");
  assert.equal(otherLocale("zh"), "en");
});
