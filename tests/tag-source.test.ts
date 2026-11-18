// Which SalesProcess tags count as an opt-in source (plan phase 2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { tagSource } from "../lib/import/tag-source.ts";

test("ad tags are paid ads", () => {
  assert.deepEqual(tagSource("[source] meta ads"), {
    sourceType: "paid_ad",
    entryPoint: "Meta ads",
  });
  assert.equal(tagSource("Facebook Form")?.sourceType, "paid_ad");
});

test("event registrations name the event, without the suffix", () => {
  assert.deepEqual(tagSource("[event] webinar - registrant"), {
    sourceType: "event",
    entryPoint: "webinar",
  });
  assert.equal(
    tagSource("[event] ai365 hub open day")?.entryPoint,
    "ai365 hub open day",
  );
});

test("masterclass and workshop tags are events", () => {
  assert.deepEqual(tagSource("[masterclass] 18 nov vibe coding en"), {
    sourceType: "event",
    entryPoint: "masterclass 18 nov vibe coding en",
  });
  assert.equal(
    tagSource("[workshop] 7 july claude ai (eng)")?.sourceType,
    "event",
  );
});

test("what happened after sign-up is not a source", () => {
  for (const t of [
    "[event] webinar - attended",
    "[event] webinar - no-show",
    "[event] claude ai masterclass - purchased",
    "[event] macmini unbox attendee",
  ])
    assert.equal(tagSource(t), null, t);
});

test("language, onboarding, course and free-text tags are left unmapped", () => {
  for (const t of [
    "[language] chinese",
    "[live] chinese reader",
    "[onboard] 6 aug claude mastery",
    "[course] ai automation 9-10 june (eng)",
    "[interest] ai engineering",
    "penang 2122 follow up",
    "cold lead",
  ])
    assert.equal(tagSource(t), null, t);
});
