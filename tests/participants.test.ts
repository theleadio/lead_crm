// The participant sheet's parsing and class matching, without a database.
// The labels are the shapes the sheet really holds (migration 026).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSyncKey,
  datedLabels,
  matchClass,
  parseLabel,
  prepareRow,
  readPhone,
  readSource,
  syncKeys,
  type ClassFact,
} from "../lib/sync/participants.ts";

test("parseLabel reads the start day and month in every shape the sheet uses", () => {
  const day = (s: string) => {
    const l = parseLabel(s);
    return l && [l.day, l.month];
  };
  assert.deepEqual(day("N8N: 11-12 Nov (HRDC)"), [11, 11]);
  assert.deepEqual(day("Claude: 1 Nov"), [1, 11]);
  assert.deepEqual(day("LTF 10 Sept (ENG)"), [10, 9]);
  assert.deepEqual(day("Vibe Coding Workshop 17 sep"), [17, 9]);
  assert.deepEqual(day("N8N: 14 -15 Sep (HRDC)"), [14, 9]);
  assert.deepEqual(day("N8N: Aug 13"), [13, 8]);
  assert.deepEqual(day("AI Agent Mastery April 4"), [4, 4]);
  assert.deepEqual(day("AI Engineering: Oct 25-26"), [25, 10]);
  assert.deepEqual(day("N8N: 9-10 June (HRDC)"), [9, 6]);
  assert.deepEqual(day("OpenClaw (Chi): March 5"), [5, 3]);
  assert.deepEqual(day("AI OS: 24-25 Oct CHI (HRDC)"), [24, 10]);
});

test("parseLabel: no date is not a class, and (HRDC) is a flag, not part of the name", () => {
  assert.equal(parseLabel("LEADERS Club"), null);
  assert.equal(parseLabel("..."), null);
  assert.equal(parseLabel("N8N: Aug 13,…"), null);
  assert.equal(parseLabel("   "), null);
  const a = parseLabel("N8N: 11-12 Nov (HRDC)")!;
  const b = parseLabel("N8N:  11-12 Nov")!;
  assert.equal(a.labelNorm, b.labelNorm);
  assert.deepEqual([a.hrdc, b.hrdc], [true, false]);
});

test("datedLabels walks the year down a newest-first list", () => {
  const got = datedLabels(
    "N8N: 11-12 Nov, LTF 10 Sept (ENG), N8N (Chi-JB): May 16-17, Vibe: Jan 10-11, AI Engineering: Oct 25-26, Vibe: Sept 27-28",
    "2026-11-12",
  );
  assert.deepEqual(
    got.map((l) => l.classDate),
    [
      "2026-11-11",
      "2026-09-10",
      "2026-05-16",
      "2026-01-10",
      "2025-10-25",
      "2025-09-27",
    ],
  );
});

test("datedLabels skips an undated label without moving the year", () => {
  const got = datedLabels(
    "AI Agents: 27-28 Oct, LEADERS Club, N8N: 9-10 June",
    "2026-10-28",
  );
  assert.deepEqual(
    got.map((l) => l.classDate),
    ["2026-10-27", "2026-06-09"],
  );
});

const classes: ClassFact[] = [
  {
    id: "automation",
    start_date: "2026-11-11",
    course_name: "AI Agentic Automation Certification",
    code: "ai-automation-11-12-Nov",
  },
  {
    id: "claude",
    start_date: "2026-11-01",
    course_name: "Claude AI Mastery",
    code: "claude-ai-mastery-1-Nov",
  },
  {
    id: "vibe",
    start_date: "2026-10-23",
    course_name: "AI Vibe Coding",
    code: "vibe-coding-23-Oct",
  },
  {
    id: "agents-found",
    start_date: "2026-10-27",
    course_name: "AI Agents Foundation",
    code: "ai-agents-foundation-27-28-Oct",
  },
  {
    id: "engineering",
    start_date: "2026-10-17",
    course_name: "Professional AI Engineering Certification",
    code: "ai-engineering-17-18-Oct",
  },
  {
    id: "datasci",
    start_date: "2026-10-17",
    course_name: "AI for Data Science Certification",
    code: "data-science-17",
  },
];

test("matchClass: the one class on that date, or the course word when several share it", () => {
  const one = (cell: string, latest: string) => datedLabels(cell, latest)[0];
  assert.equal(
    matchClass(one("Claude: 1 Nov", "2026-11-01"), classes),
    "claude",
  );
  assert.equal(
    matchClass(one("N8N: 11-12 Nov (HRDC)", "2026-11-12"), classes),
    "automation",
  );
  assert.equal(
    matchClass(one("AI Agents: 27-28 Oct", "2026-10-28"), classes),
    "agents-found",
  );
  // Two classes on 17 Oct: the course word decides.
  assert.equal(
    matchClass(one("AI Engineering: 17-18 Oct", "2026-10-18"), classes),
    "engineering",
  );
  assert.equal(
    matchClass(one("Data Science: 17 Oct", "2026-10-17"), classes),
    "datasci",
  );
  // Two on the day and nothing to tell them apart: left for a person.
  assert.equal(matchClass(one("Mystery: 17 Oct", "2026-10-17"), classes), null);
  // No class that day.
  assert.equal(matchClass(one("Claude: 2 Nov", "2026-11-02"), classes), null);
});

test("readPhone: the sheet's real phone shapes", () => {
  assert.equal(readPhone("60127498722").e164, "+60127498722");
  assert.equal(readPhone("012-3025024").e164, "+60123025024");
  assert.equal(readPhone("016-203 5478").e164, "+60162035478");
  assert.equal(readPhone("60 18-223 8479").e164, "+60182238479");
  assert.equal(readPhone("016-3317277 (correct number)").e164, "+60163317277");
  assert.equal(readPhone("65 93887553").e164, "+6593887553");
  // Unreadable: kept as typed, no e164 (never dropped).
  assert.deepEqual(readPhone("call me"), { text: "call me", e164: null });
  assert.deepEqual(readPhone(""), { text: null, e164: null });
});

test("prepareRow: a name and one way to reach the person are needed", () => {
  const row = {
    name: "A",
    email: "",
    mobile: "",
    classes: "",
    latestClassDate: "",
    source: "",
  };
  assert.equal(prepareRow({ ...row, name: "" }), "no_name");
  assert.equal(prepareRow(row), "no_contact");
  const ok = prepareRow({
    ...row,
    email: "Grace@OSDconsultants.com.my",
    classes: "Claude: 1 Nov",
    latestClassDate: "2026-11-01",
  });
  assert.ok(typeof ok === "object");
  if (typeof ok === "object") {
    assert.equal(ok.emailNorm, "grace@osdconsultants.com.my");
    assert.equal(ok.labels.length, 1);
  }
  // A bad email alone is not contact.
  assert.equal(prepareRow({ ...row, email: "not an email" }), "no_contact");
});

test("readSource: the Source column's answers, never a specific ad", () => {
  assert.equal(readSource("Facebook ad"), "facebook_ad");
  assert.equal(readSource("WhatsApp ad"), "whatsapp_ad");
  assert.equal(readSource("Referral"), "referral");
  assert.equal(readSource("Returning student"), "returning_student");
  assert.equal(readSource("Google"), "google");
  assert.equal(readSource("saw a poster"), "other");
  assert.equal(readSource("  "), null);
});

test("the sync key: closed unless set, long enough, and never the public key", () => {
  const key = "k".repeat(20);
  assert.equal(checkSyncKey({}, key), "unconfigured");
  assert.equal(
    checkSyncKey({ PARTICIPANT_SYNC_KEY: "short" }, "short"),
    "unconfigured",
  );
  assert.equal(checkSyncKey({ PARTICIPANT_SYNC_KEY: key }, key), "ok");
  assert.equal(
    checkSyncKey({ PARTICIPANT_SYNC_KEY: key }, "x".repeat(20)),
    "bad",
  );
  assert.equal(checkSyncKey({ PARTICIPANT_SYNC_KEY: key }, null), "bad");
  // The same secret as the public key is refused, so a browser key can't sync.
  assert.equal(
    checkSyncKey({ PARTICIPANT_SYNC_KEY: key, PUBLIC_API_KEY: key }, key),
    "unconfigured",
  );
  // Rotation: two keys, either works.
  const two = { PARTICIPANT_SYNC_KEY: `${key},${"z".repeat(20)}` };
  assert.equal(syncKeys(two).length, 2);
  assert.equal(checkSyncKey(two, "z".repeat(20)), "ok");
});
