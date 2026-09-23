import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPersonQuery } from "../lib/people/search.ts";
import { computeLifecycleStage } from "../lib/people/lifecycle.ts";
import { listPeople } from "../lib/people/service.ts";
import { formatLastActivity } from "../lib/format/date.ts";

const person = {
  fullName: "Tan Mei Ling",
  email: "meiling@example.com",
  phoneE164: "+60123456789",
};

// Spec §9.1: all three phone shapes must find the same person.
test("search finds a person by any phone shape", () => {
  assert.equal(matchesPersonQuery(person, "012-345 6789"), true);
  assert.equal(matchesPersonQuery(person, "+60123456789"), true);
  assert.equal(matchesPersonQuery(person, "123456789"), true);
  assert.equal(matchesPersonQuery(person, "019-999 9999"), false);
});

test("search matches name and email case-insensitively", () => {
  assert.equal(matchesPersonQuery(person, "mei ling"), true);
  assert.equal(matchesPersonQuery(person, "MEILING@"), true);
  assert.equal(matchesPersonQuery(person, "Ali"), false);
});

test("search handles a person with no phone", () => {
  assert.equal(
    matchesPersonQuery({ ...person, phoneE164: null }, "0123456789"),
    false,
  );
});

// Spec §12.3
test("lifecycle stage: customer beats student beats lead", () => {
  assert.equal(
    computeLifecycleStage({
      hasSucceededPayment: true,
      hasEnrolmentConfirmedOrLater: true,
    }),
    "customer",
  );
  assert.equal(
    computeLifecycleStage({
      hasSucceededPayment: false,
      hasEnrolmentConfirmedOrLater: true,
    }),
    "student",
  );
  assert.equal(
    computeLifecycleStage({
      hasSucceededPayment: false,
      hasEnrolmentConfirmedOrLater: false,
    }),
    "lead",
  );
});

// Spec §7 list conventions: { data, page: { total, page, limit } }, paginated.
const admin = { id: "admin", role: "super_admin" as const };

test("listPeople paginates and reports the total", async () => {
  const first = await listPeople({ page: 1, limit: 25 }, admin);
  assert.equal(first.data.length, 25);
  assert.equal(first.page.limit, 25);
  assert.ok(first.page.total > 25);

  const last = await listPeople({ page: 3, limit: 25 }, admin);
  assert.equal(last.data.length, first.page.total - 50);
});

test("listPeople filters by needsReview", async () => {
  const flagged = await listPeople(
    { page: 1, limit: 100, needsReview: true },
    admin,
  );
  assert.ok(flagged.data.length > 0);
  assert.ok(flagged.data.every((p) => p.needsReview));
});

// Spec §9.1 Last activity rendering.
test("formatLastActivity: relative under 7 days, absolute after, dash when none", () => {
  const now = new Date("2026-09-23T04:00:00Z");
  assert.equal(formatLastActivity(null, now), "—");
  assert.equal(formatLastActivity("not a date", now), "—");
  assert.equal(formatLastActivity("2026-09-20T04:00:00Z", now), "3 days ago");
  assert.equal(formatLastActivity("2026-08-14T04:00:00Z", now), "14 Aug 2026");
});
