// Spec §9.13 screen rules that do not need a browser: the cells, the dash,
// the age wording, the past-SLA marker, who sees which action, and that the
// URL round-trips the view. The rendering itself is checked in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EnquiryRow } from "../lib/enquiries/types.ts";
import {
  enquiryListQuerySchema,
  readEnquiryParams,
} from "../lib/validation/enquiry-query.ts";
import {
  DASH,
  PAST_SLA_MARKER,
  QUEUE_COLUMNS,
  ageLabel,
  enquiryLabel,
  isFiltered,
  openDeals,
  queueCells,
  queueDateTime,
  queueParams,
  rowActions,
  type QueueView,
} from "../app/(app)/(crm)/enquiries/queue-view.ts";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const SUPPORT_TEAM = "00000000-0000-4000-8000-0000000000t1";
const FINANCE_TEAM = "00000000-0000-4000-8000-0000000000t2";

const row = (over: Partial<EnquiryRow> = {}): EnquiryRow => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  number: "E-000001",
  subject: null,
  version: 1,
  personId: "00000000-0000-4000-8000-0000000000p1",
  personName: "Tan Mei Ling",
  channel: "whatsapp",
  category: null,
  categoryLabel: null,
  teamId: SUPPORT_TEAM,
  teamName: "Support",
  priority: "normal",
  status: "open",
  assignedUserId: null,
  assigneeName: null,
  firstMessageAt: null,
  firstResponseAt: null,
  waitedMinutes: 5,
  slaDueAt: null,
  pastSla: false,
  dealId: null,
  ...over,
});

const dir = "app/(app)/(crm)/enquiries";
const source = (file: string) => readFileSync(`${dir}/${file}`, "utf8");

test("the eight §9.13 columns, in order, plus Team (migration 019)", () => {
  assert.deepEqual(QUEUE_COLUMNS, [
    "Person",
    "Channel",
    "Category",
    "Team",
    "Status",
    "Assigned",
    "First message",
    "First response",
    "Age",
  ]);
  assert.equal(queueCells(row()).length, QUEUE_COLUMNS.length);
});

test("no first message and no reply read as dashes, not invented times", () => {
  const cells = queueCells(row());
  assert.equal(cells[6], DASH);
  assert.equal(cells[7], DASH);
  // Unset category and assignee too.
  assert.equal(cells[2], DASH);
  assert.equal(cells[5], DASH);
  // The team always has a name: every enquiry has one.
  assert.equal(cells[3], "Support");
});

test("a category reads with its label from Settings", () => {
  assert.equal(
    queueCells(row({ category: "einvoice", categoryLabel: "E-invoice" }))[2],
    "E-invoice",
  );
  // A code with no row left still reads as words.
  assert.equal(queueCells(row({ category: "course_info" }))[2], "Course info");
});

test("set times are shown", () => {
  const cells = queueCells(
    row({
      firstMessageAt: "2026-11-03T01:00:00.000Z",
      firstResponseAt: "2026-11-03T01:10:00.000Z",
    }),
  );
  assert.notEqual(cells[6], DASH);
  assert.notEqual(cells[7], DASH);
});

test("a person with no name shows the phone the server put in its place", () => {
  // `displayName` runs on the server (tests/enquiries-routes); the view shows
  // what it was given, unchanged.
  assert.equal(
    queueCells(row({ personName: "+60123456789" }))[0],
    "+60123456789",
  );
});

test("the age reads in the two largest units", () => {
  assert.equal(ageLabel(0), "Under a minute");
  assert.equal(ageLabel(45), "45m");
  assert.equal(ageLabel(60), "1h");
  assert.equal(ageLabel(185), "3h 5m");
  assert.equal(ageLabel(24 * 60), "1d");
  assert.equal(ageLabel(2 * 24 * 60 + 4 * 60 + 30), "2d 4h");
});

test("this year's dates drop the year, older ones keep it", () => {
  const now = new Date("2026-11-05T02:00:00.000Z");
  assert.equal(
    queueDateTime("2026-10-26T09:05:00.000Z", now),
    "26 Oct, 5:05pm",
  );
  assert.equal(
    queueDateTime("2025-10-26T09:05:00.000Z", now),
    "26 Oct 2025, 5:05pm",
  );
});

test("the first response reads as how long the reply took", () => {
  const cells = queueCells(
    row({
      firstMessageAt: "2026-11-03T01:00:00.000Z",
      firstResponseAt: "2026-11-03T01:10:00.000Z",
    }),
  );
  assert.equal(cells[7], "10m");
});

test("labels spell brand and acronym values properly", () => {
  assert.equal(enquiryLabel("whatsapp"), "WhatsApp");
  assert.equal(enquiryLabel("hrdc"), "HRDC");
  assert.equal(enquiryLabel("course_info"), "Course info");
  assert.equal(enquiryLabel("waiting_customer"), "Waiting on customer");
  assert.equal(enquiryLabel("web_form"), "Help form");
});

test("a past-SLA row has a text marker beside the highlight (§14)", () => {
  assert.equal(PAST_SLA_MARKER, "Past SLA");
  const queue = source("enquiries-queue.tsx");
  assert.match(queue, /row\.pastSla && \(/);
  assert.match(queue, /\{PAST_SLA_MARKER\}/);
});

// --- Who sees which action (§6, 4.4) ------------------------------------

const full = { viewerId: ME, canWrite: true, assignedOnly: false, teamIds: [] };
const readOnly = {
  viewerId: ME,
  canWrite: false,
  assignedOnly: false,
  teamIds: [],
};
const partTime = {
  viewerId: ME,
  canWrite: true,
  assignedOnly: true,
  teamIds: [],
};
// A read-only role in the Finance team (migration 019).
const financeMember = { ...readOnly, teamIds: [FINANCE_TEAM] };

test("support and super_admin get every action on an open row", () => {
  assert.deepEqual(rowActions(row(), full), {
    assign: true,
    category: true,
    close: true,
    convert: false,
  });
});

test("management, sales and operations get no action at all", () => {
  for (const r of [row(), row({ assignedUserId: ME })])
    assert.deepEqual(rowActions(r, readOnly), {
      assign: false,
      category: false,
      close: false,
      convert: false,
    });
});

test("a part-timer acts only on their own row, and never assigns", () => {
  assert.deepEqual(rowActions(row({ assignedUserId: ME }), partTime), {
    assign: false,
    category: true,
    close: true,
    convert: false,
  });
  for (const assignedUserId of [OTHER, null])
    assert.deepEqual(rowActions(row({ assignedUserId }), partTime), {
      assign: false,
      category: false,
      close: false,
      convert: false,
    });
});

test("a closed enquiry offers no close; a waiting one does", () => {
  for (const status of ["closed", "human_resolved", "converted"] as const)
    assert.equal(rowActions(row({ status }), full).close, false, status);
  assert.equal(
    rowActions(row({ status: "waiting_customer" }), full).close,
    true,
  );
});

test("a team member works their team's rows whatever their role", () => {
  assert.deepEqual(rowActions(row({ teamId: FINANCE_TEAM }), financeMember), {
    assign: true,
    category: true,
    close: true,
    convert: false,
  });
  // …and only their team's.
  assert.deepEqual(rowActions(row(), financeMember), {
    assign: false,
    category: false,
    close: false,
    convert: false,
  });
});

// --- The URL is the view (4.2) ------------------------------------------

const view: QueueView = {
  q: "mei",
  status: "all",
  category: "hrdc",
  team: SUPPORT_TEAM.replace("t1", "01"),
  myTeams: true,
  channel: "whatsapp",
  assignee: "unassigned",
  mine: true,
  sort: "-age",
  page: 3,
  selected: "00000000-0000-4000-8000-0000000000e1",
};

test("a URL with filters, sort, page and selection reads back as that view", () => {
  const params = queueParams(view);
  const parsed = enquiryListQuerySchema.parse(readEnquiryParams(params));
  assert.equal(parsed.q, "mei");
  assert.equal(parsed.status, "all");
  assert.equal(parsed.category, "hrdc");
  assert.equal(parsed.team, view.team);
  assert.equal(parsed.myTeams, true);
  assert.equal(parsed.channel, "whatsapp");
  assert.equal(parsed.assignee, "unassigned");
  assert.equal(parsed.mine, true);
  assert.equal(parsed.sort, "-age");
  assert.equal(parsed.page, 3);
  assert.equal(params.get("selected"), view.selected);
});

test("the default view leaves the URL bare", () => {
  const bare: QueueView = {
    q: "",
    status: "active",
    category: "",
    team: "",
    myTeams: false,
    channel: "",
    assignee: "",
    mine: false,
    sort: "",
    page: 1,
    selected: "",
  };
  assert.equal(queueParams(bare).toString(), "");
  assert.equal(isFiltered(bare), false);
  assert.equal(isFiltered({ ...bare, status: "closed" }), true);
  assert.equal(isFiltered({ ...bare, mine: true }), true);
  assert.equal(isFiltered({ ...bare, status: "open" }), true);
  assert.equal(isFiltered({ ...bare, myTeams: true }), true);
  // Sorting or paging is not filtering.
  assert.equal(isFiltered({ ...bare, sort: "-age", page: 2 }), false);
});

// --- The §13 states and the stub (4.2, 4.3) -----------------------------

test("the stub is gone; New enquiry shows only to those who may create", () => {
  assert.doesNotMatch(source("page.tsx"), /Not available yet/);
  for (const file of ["page.tsx", "context-panel.tsx"])
    assert.doesNotMatch(source(file), /Add enquiry|New enquiry/i, file);
  const queue = source("enquiries-queue.tsx");
  assert.match(queue, /\{canCreate && \(/);
  assert.match(queue, /href="\/enquiries\/new"/);
  assert.match(queue, /<SkeletonRows/);
  assert.match(queue, /<ListError/);
  assert.match(queue, /No enquiries match these filters/);
  assert.match(queue, /Clear filters/);
  assert.match(
    queue,
    /They arrive from WhatsApp, the help\s+form and the inbox, or are added by hand/,
  );
});

// --- The context panel (5.x) ---------------------------------------------

test("open deals leave out won and lost", () => {
  const deal = (stage: string) => ({
    id: stage,
    pipeline: "individual" as const,
    stage,
    courseName: "AIM",
    amountMyr: "0",
    owner: null,
  });
  assert.deepEqual(
    openDeals(["new", "won", "lost", "funding"].map(deal)).map((d) => d.stage),
    ["new", "funding"],
  );
});

test("convert sends to its route with If-Match, and a converted enquiry links its deal", () => {
  const panel = source("context-panel.tsx");
  assert.match(panel, /shortcut: /);
  assert.match(panel, /`\/api\/enquiries\/\$\{enquiry\.id\}\/convert`/);
  // Both version headers, via the helper (the live site drops If-Match).
  assert.match(panel, /versionHeaders\(enquiry\.version\)/);
  assert.match(panel, /if \(!canConvert\) return null;/);
  assert.match(panel, /enquiry\.status === "converted" && enquiry\.dealId/);
  assert.match(panel, /href=\{`\/deals\/\$\{enquiry\.dealId\}`\}/);
  // The five §9.13 sections and the §9.2 link.
  for (const title of ["Contact", "Company", "Open deals", "Enrolments"])
    assert.match(panel, new RegExp(`title="${title}"`), title);
  assert.match(panel, /href=\{`\/people\/\$\{person\.id\}`\}/);
});

test("convert is offered only with deal write, on a row still being worked", () => {
  const withDeals = { ...full, canWriteDeal: true };
  assert.equal(rowActions(row(), withDeals).convert, true);
  assert.equal(rowActions(row(), full).convert, false, "no deal write");
  assert.equal(rowActions(row({ status: "closed" }), withDeals).convert, false);
});
