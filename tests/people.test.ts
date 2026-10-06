import { test } from "node:test";
import assert from "node:assert/strict";
import { likeEscape, parsePersonQuery } from "../lib/people/search.ts";
import { displayName } from "../lib/people/types.ts";
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
  // Short prefixes count too — "012" is what you have typed after 3 keys.
  assert.equal(parsePersonQuery("012")?.digits, "012");
  // A number that normalises still keeps its digits: 012-000 7919 is stored
  // as +60120007919, so the typed digits are no substring of the stored ones.
  assert.equal(parsePersonQuery("012-000 7919")?.digits, "0120007919");
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

// Spec §11.2: a WhatsApp-only contact may have no usable name, so the phone
// stands in for it — on the 9.1 list, 9.2 detail, 9.4 members and the 9.10
// roster alike, because they all ask this one function.
test("displayName: a name wins, then the phone, then Unnamed", () => {
  assert.equal(displayName("Tan Mei Ling", "012-345 6789"), "Tan Mei Ling");
  assert.equal(displayName(null, "012-345 6789"), "012-345 6789");
  assert.equal(displayName("", "012-345 6789"), "012-345 6789");
  // A name of spaces is no name: " " would otherwise print as a blank cell.
  assert.equal(displayName("   ", "012-345 6789"), "012-345 6789");
  assert.equal(displayName("  Tan Mei Ling  ", null), "Tan Mei Ling");
  assert.equal(displayName(null, null), "Unnamed");
  assert.equal(displayName(undefined, "  "), "Unnamed");
});
