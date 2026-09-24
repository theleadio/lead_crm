import { test } from "node:test";
import assert from "node:assert/strict";
import { likeEscape, parsePersonQuery } from "../lib/people/search.ts";
import { formatLastActivity } from "../lib/format/date.ts";

// Spec §9.1: all three phone shapes must find the same person.
test("parsePersonQuery: complete numbers normalise to the same E.164", () => {
  for (const q of ["012-345 6789", "+60123456789", "123456789"])
    assert.equal(parsePersonQuery(q)?.phoneE164, "+60123456789", q);
});

test("parsePersonQuery: partial numbers become a digit search, names don't", () => {
  assert.deepEqual(parsePersonQuery("456789"), {
    text: "456789",
    phoneE164: null,
    digits: "456789",
  });
  const name = parsePersonQuery(" Tan Mei ");
  assert.equal(name?.text, "Tan Mei");
  assert.equal(name?.phoneE164, null);
  assert.equal(name?.digits, null);
  assert.equal(parsePersonQuery("   "), null);
});

test("likeEscape stops user input acting as LIKE wildcards", () => {
  assert.equal(likeEscape("50%_off\\"), "50\\%\\_off\\\\");
});

// Spec §9.1 Last activity rendering.
test("formatLastActivity: relative under 7 days, absolute after, dash when none", () => {
  const now = new Date("2026-09-23T04:00:00Z");
  assert.equal(formatLastActivity(null, now), "—");
  assert.equal(formatLastActivity("not a date", now), "—");
  assert.equal(formatLastActivity("2026-09-20T04:00:00Z", now), "3 days ago");
  assert.equal(formatLastActivity("2026-08-14T04:00:00Z", now), "14 Aug 2026");
});
