// The first-reply deadline of an enquiry (lib/enquiries/deadline.ts, moved
// from lead_sales with migration 019): the same time on the
// next working day, office hours Mon–Fri 08:30–16:30 Malaysia time.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countFrom,
  isOfficeHours,
  replyDueAt,
} from "../lib/enquiries/deadline.ts";

// Malaysia local time → Date (UTC+8).
const myt = (s: string) => new Date(`${s}+08:00`);
const none = new Set<string>();

// Nov 2026: Mon 2, Tue 3, Wed 4, Thu 5, Fri 6, Sat 7, Sun 8, Mon 9, Tue 10.
test("the spec's three examples", () => {
  assert.deepEqual(
    replyDueAt(myt("2026-11-03T10:00:00"), none),
    myt("2026-11-04T10:00:00"),
    "Tue 10 AM → Wed 10 AM",
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-06T15:00:00"), none),
    myt("2026-11-09T15:00:00"),
    "Fri 3 PM → Mon 3 PM",
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-06T17:00:00"), none),
    myt("2026-11-10T08:30:00"),
    "Fri 5 PM → counts from Mon 8:30 → Tue 8:30",
  );
});

test("before opening counts from 08:30 the same day; 16:30 is closed", () => {
  assert.deepEqual(
    countFrom(myt("2026-11-03T07:15:00"), none),
    myt("2026-11-03T08:30:00"),
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-03T07:15:00"), none),
    myt("2026-11-04T08:30:00"),
  );
  assert.equal(isOfficeHours(myt("2026-11-03T08:30:00"), none), true);
  assert.equal(isOfficeHours(myt("2026-11-03T16:29:59"), none), true);
  assert.equal(isOfficeHours(myt("2026-11-03T16:30:00"), none), false);
  assert.deepEqual(
    replyDueAt(myt("2026-11-03T16:30:00"), none),
    myt("2026-11-05T08:30:00"),
    "Tue 16:30 → counts from Wed 8:30 → Thu 8:30",
  );
});

test("weekends count from Monday's opening", () => {
  assert.deepEqual(
    replyDueAt(myt("2026-11-07T11:00:00"), none),
    myt("2026-11-10T08:30:00"),
    "Sat → Mon 8:30 → Tue 8:30",
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-08T23:59:00"), none),
    myt("2026-11-10T08:30:00"),
  );
});

test("holidays are skipped, both to start and to be due", () => {
  const hol = new Set(["2026-11-04", "2026-11-09"]);
  assert.deepEqual(
    replyDueAt(myt("2026-11-03T10:00:00"), hol),
    myt("2026-11-05T10:00:00"),
    "Tue → (Wed holiday) → Thu",
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-04T10:00:00"), hol),
    myt("2026-11-06T08:30:00"),
    "on a holiday: counts from Thu 8:30 → Fri 8:30",
  );
  assert.deepEqual(
    replyDueAt(myt("2026-11-06T15:00:00"), hol),
    myt("2026-11-10T15:00:00"),
    "Fri → (weekend, Mon holiday) → Tue",
  );
});

test("Malaysian midnight, not UTC midnight, is the day boundary", () => {
  // 2026-11-03 23:30 UTC is Wed 07:30 in Malaysia.
  assert.deepEqual(
    replyDueAt(new Date("2026-11-03T23:30:00Z"), none),
    myt("2026-11-05T08:30:00"),
  );
});

test("a year of holidays is reported, not looped on", () => {
  const all = new Set<string>();
  for (let d = 0; d < 400; d++)
    all.add(
      new Date(Date.UTC(2026, 10, 1) + d * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  assert.throws(() => replyDueAt(myt("2026-11-03T10:00:00"), all), /holiday/);
});
