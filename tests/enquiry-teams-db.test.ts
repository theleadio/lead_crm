// The ticket rules folded into enquiries (migration 019): routing to a team,
// round robin, the next-working-day deadline, who may see what, waiting on
// the customer, notes, follow-ups and the history. Ported from lead_sales'
// tickets tests. Each test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { mayUseEnquiries } from "../lib/enquiries/access.ts";
import {
  createEnquiry,
  followUpEnquiry,
  type NewEnquiry,
} from "../lib/enquiries/create.ts";
import { enquiryDetail } from "../lib/enquiries/detail.ts";
import { listEnquiries } from "../lib/enquiries/list.ts";
import { suggestCategory } from "../lib/enquiries/routing.ts";
import {
  addEnquiryNote,
  assignEnquiry,
  closeEnquiry,
  markFirstResponse,
  setEnquiryCategory,
  setEnquiryStatus,
} from "../lib/enquiries/service.ts";
import { closeDb, db, withTransaction } from "../lib/sql.ts";
import { enquiryListQuerySchema } from "../lib/validation/enquiry-query.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

const none = new Set<string>();

async function teamId(code: string): Promise<string> {
  const [t] = await db()`SELECT id FROM team WHERE code = ${code}`;
  return t.id as string;
}

async function member(
  code: string,
  role: Parameters<typeof newUser>[0] = "support",
) {
  const u = await newUser(role);
  await db()`
    INSERT INTO team_member (team_id, user_id)
    VALUES (${await teamId(code)}, ${u.id})`;
  return u;
}

// Each test starts with empty teams and no rules, so it sees only its own.
async function fresh() {
  await db()`DELETE FROM enquiry_rule`;
  await db()`DELETE FROM team_member`;
}

async function make(
  category: string,
  viewer: Viewer | null,
  over: Partial<NewEnquiry> = {},
) {
  const r = await createEnquiry(
    {
      personId: await newPerson("Enquiry Customer"),
      channel: "phone",
      category,
      subject: "Need my e-invoice",
      receivedAt: new Date("2026-11-03T10:00:00+08:00"),
      ...over,
    },
    viewer,
    none,
  );
  assert.equal(r.kind, "ok", JSON.stringify(r));
  if (r.kind !== "ok") throw new Error("not created");
  return r.enquiry;
}

const versionOf = async (id: string) =>
  Number((await db()`SELECT version FROM enquiry WHERE id = ${id}`)[0].version);

const visibleTo = async (viewer: Viewer, id: string) =>
  (
    await listEnquiries(
      enquiryListQuerySchema.parse({ status: "all", limit: "100" }),
      viewer,
    )
  ).data.some((r) => r.id === id);

it("a category routes to its team, round robin, with the next-working-day deadline", async () => {
  await fresh();
  const a = await member("finance");
  const b = await member("finance");
  const agent = await newUser("support");
  const e1 = await make("einvoice", agent);
  const e2 = await make("receipt", agent);
  const e3 = await make("einvoice", agent);
  assert.equal(e1.teamId, await teamId("finance"));
  assert.match(e1.number, /^E-\d{6}$/);
  assert.notEqual(e1.number, e2.number);
  // Round robin: two different people, then back to the first.
  assert.deepEqual(
    new Set([e1.assignedUserId, e2.assignedUserId]),
    new Set([a.id, b.id]),
  );
  assert.equal(e3.assignedUserId, e1.assignedUserId);
  assert.deepEqual(e1.slaDueAt, new Date("2026-11-04T10:00:00+08:00"));
  const [row] = await db()`
    SELECT status, first_message_at, created_by FROM enquiry WHERE id = ${e1.id}`;
  assert.equal(row.status, "open");
  assert.deepEqual(row.first_message_at, new Date("2026-11-03T10:00:00+08:00"));
  assert.equal(row.created_by, agent.id);
  const [ev] = await db()`
    SELECT kind, after FROM enquiry_event WHERE enquiry_id = ${e1.id}`;
  assert.equal(ev.kind, "created");
  assert.equal(ev.after.category, "einvoice");
  assert.equal(ev.after.subject, undefined, "no free text in the event");
  const [audit] = await db()`
    SELECT action, after FROM audit_log WHERE entity = 'enquiry' AND entity_id = ${e1.id}`;
  assert.equal(audit.action, "create");
  assert.equal(audit.after.subject, undefined, "no free text in audit_log");
});

it("an inactive member is skipped; a team with no one leaves it unassigned", async () => {
  await fresh();
  const gone = await member("tech");
  await db()`UPDATE app_user SET is_active = false WHERE id = ${gone.id}`;
  const e = await make("voucher", null);
  assert.equal(e.teamId, await teamId("tech"));
  assert.equal(e.assignedUserId, null);
});

it("the first matching rule wins: team and fixed assignee", async () => {
  await fresh();
  const qiEn = await member("operations", "operations");
  await db()`
    INSERT INTO enquiry_rule (position, match_channel, set_team_id, assign_mode, assign_user_id)
    VALUES (1, 'web_form', ${await teamId("operations")}, 'fixed', ${qiEn.id}),
           (2, 'whatsapp', NULL, 'none', NULL)`;
  const web = await make("other", null, { channel: "web_form" });
  assert.equal(web.teamId, await teamId("operations"));
  assert.equal(web.assignedUserId, qiEn.id);
  const wa = await make("other", null, { channel: "whatsapp" });
  assert.equal(wa.teamId, await teamId("support"));
  assert.equal(wa.assignedUserId, null, "rule 2: assign none");
});

it("keywords suggest a category; nothing matches → null", async () => {
  assert.equal(
    await suggestCategory("Hi, can I get the E-Invoice please"),
    "einvoice",
  );
  assert.equal(await suggestCategory("my voucher code fails"), "voucher");
  assert.equal(await suggestCategory("我需要收据"), "receipt");
  assert.equal(await suggestCategory("what time is class?"), null);
});

it("an unknown or switched-off category is refused at create", async () => {
  const r = await createEnquiry(
    {
      personId: await newPerson("X"),
      channel: "phone",
      category: "no_such",
      subject: "x",
    },
    await newUser("support"),
    none,
  );
  assert.deepEqual(r, {
    kind: "invalid",
    field: "category",
    message: "Pick a category from the list",
  });
  assert.equal(
    (
      await createEnquiry(
        {
          personId: await newPerson("X"),
          channel: "phone",
          category: "other",
          subject: "x",
        },
        await newUser("marketing"),
        none,
      )
    ).kind,
    "forbidden",
    "marketing outside a team can't create",
  );
});

it("Finance enquiries: only Finance, super_admin and management see them", async () => {
  await fresh();
  const fin = await member("finance", "operations");
  const agent = await newUser("support");
  const boss = await newUser("management");
  const e = await make("einvoice", agent);

  assert.ok(await visibleTo(fin, e.id), "the team member");
  assert.ok(await visibleTo(boss, e.id), "management");
  assert.ok(
    !(await visibleTo(agent, e.id)),
    "support can't see a restricted team's enquiry, even one they made",
  );
  assert.equal(await enquiryDetail(agent, e.id), null);
  const [denied] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity = 'enquiry' AND entity_id = ${e.id}`;
  assert.ok(denied, "the refusal is audited");
  assert.equal((await addEnquiryNote(e.id, "peek", agent)).kind, "not_found");
  assert.equal(
    (await setEnquiryStatus(e.id, "waiting_customer", 1, agent)).kind,
    "not_found",
  );

  // A non-restricted team's enquiry stays visible to support.
  const tech = await make("voucher", agent);
  assert.ok(await visibleTo(agent, tech.id));
});

it("a team member works their team's enquiries whatever their role", async () => {
  await fresh();
  // Marketing has no §6 enquiry access at all; the team gives it.
  const mkt = await member("tech", "marketing");
  assert.equal(await mayUseEnquiries(mkt, "write"), true);
  const ours = await make("voucher", null);
  const theirs = await make("course_info", null);
  assert.ok(await visibleTo(mkt, ours.id));
  assert.ok(!(await visibleTo(mkt, theirs.id)));
  assert.equal(
    (await setEnquiryStatus(ours.id, "waiting_customer", 1, mkt)).kind,
    "ok",
  );
  assert.equal(
    (await assignEnquiry(ours.id, "me", await versionOf(ours.id), mkt)).kind,
    "ok",
  );
  assert.equal(
    (
      await setEnquiryStatus(
        theirs.id,
        "waiting_customer",
        await versionOf(theirs.id),
        mkt,
      )
    ).kind,
    "not_found",
  );
});

it("changing category moves the team and reassigns when needed", async () => {
  await fresh();
  const sup = await member("support");
  const tech = await member("tech");
  const e = await make("other", sup);
  assert.equal(e.assignedUserId, sup.id);
  const r = await setEnquiryCategory(e.id, "api_key", 1, sup);
  assert.equal(r.kind, "ok");
  const [row] = await db()`
    SELECT team_id, assigned_user_id, category FROM enquiry WHERE id = ${e.id}`;
  assert.equal(row.category, "api_key");
  assert.equal(row.team_id, await teamId("tech"));
  assert.equal(row.assigned_user_id, tech.id);
  const [ev] = await db()`
    SELECT before, after FROM enquiry_event
    WHERE enquiry_id = ${e.id} AND kind = 'category'`;
  assert.equal(ev.before.category, "other");
  assert.equal(ev.after.teamId, await teamId("tech"));
  assert.equal(
    (await setEnquiryCategory(e.id, "nope", await versionOf(e.id), sup)).kind,
    "unknown_category",
  );
});

it("a restricted team's enquiry goes only to its members", async () => {
  await fresh();
  await member("finance");
  const admin = await newUser("super_admin");
  const outsider = await newUser("support");
  const e = await make("receipt", admin);
  assert.equal(
    (await assignEnquiry(e.id, outsider.id, await versionOf(e.id), admin)).kind,
    "not_in_team",
  );
});

it("waiting on the customer, then closing from there; closed is final", async () => {
  await fresh();
  const sup = await member("support");
  const e = await make("other", sup);
  assert.equal(
    (await setEnquiryStatus(e.id, "waiting_customer", 1, sup)).kind,
    "ok",
  );
  const queue = await listEnquiries(
    enquiryListQuerySchema.parse({ limit: "100" }),
    sup,
  );
  assert.ok(
    queue.data.some((r) => r.id === e.id && r.status === "waiting_customer"),
    "the default view still shows a waiting enquiry",
  );
  assert.equal(
    (
      await closeEnquiry(
        e.id,
        { status: "human_resolved", note: "Sent it" },
        await versionOf(e.id),
        sup,
      )
    ).kind,
    "ok",
  );
  const back = await setEnquiryStatus(e.id, "open", await versionOf(e.id), sup);
  assert.equal(back.kind, "not_open");
  const kinds = await db()`
    SELECT kind, after FROM enquiry_event WHERE enquiry_id = ${e.id}
    ORDER BY created_at`;
  assert.deepEqual(
    kinds.map((k) => [k.kind, k.after?.status ?? null]),
    [
      ["created", null],
      ["status", "waiting_customer"],
      ["status", "human_resolved"],
    ],
  );
});

it("a note is history only; first response is stamped once", async () => {
  await fresh();
  const sup = await member("support");
  const e = await make("other", sup);
  assert.equal(
    (await addEnquiryNote(e.id, "Called, no answer", sup)).kind,
    "ok",
  );
  assert.equal(await versionOf(e.id), 1, "a note changes no row");
  await markFirstResponse(e.id, sup.id);
  const [r1] =
    await db()`SELECT first_response_at FROM enquiry WHERE id = ${e.id}`;
  await markFirstResponse(e.id, sup.id);
  const [r2] =
    await db()`SELECT first_response_at FROM enquiry WHERE id = ${e.id}`;
  assert.deepEqual(r2.first_response_at, r1.first_response_at);
  const d = await enquiryDetail(sup, e.id);
  assert.deepEqual(
    d!.events.map((ev) => ev.kind),
    ["created", "note", "first_response"],
  );
  assert.equal(d!.events[1].note, "Called, no answer");
});

it("a follow-up after closing links to the old one, which stays closed", async () => {
  await fresh();
  const a = await member("support");
  const e = await make("other", a, { subject: "Where is my cert?" });
  await closeEnquiry(e.id, { status: "closed", note: "Sent" }, 1, a);
  const next = await followUpEnquiry(
    e.id,
    new Date("2026-11-06T17:00:00+08:00"),
    none,
  );
  assert.equal(next.kind, "ok");
  if (next.kind !== "ok") return;
  const [old] = await db()`SELECT status FROM enquiry WHERE id = ${e.id}`;
  assert.equal(old.status, "closed");
  const [n] = await db()`
    SELECT previous_enquiry_id, subject, sla_due_at FROM enquiry WHERE id = ${next.enquiry.id}`;
  assert.equal(n.previous_enquiry_id, e.id);
  assert.equal(n.subject, "Re: Where is my cert?");
  // Fri 5 PM, after hours → counts from Mon 8:30 → due Tue 8:30.
  assert.deepEqual(n.sla_due_at, new Date("2026-11-10T08:30:00+08:00"));
  assert.equal(
    (await followUpEnquiry(next.enquiry.id, new Date(), none)).kind,
    "invalid",
    "still open",
  );
});

it("past SLA follows the deadline: no reply past it is late, a reply before it is not", async () => {
  await fresh();
  const a = await member("support");
  const old = new Date("2026-01-05T10:00:00+08:00");
  const late = await make("other", a, { receivedAt: old });
  const answered = await make("other", a, { receivedAt: old });
  await db()`
    UPDATE enquiry SET first_response_at = ${new Date("2026-01-05T11:00:00+08:00")}
    WHERE id = ${answered.id}`;
  const rows = (
    await listEnquiries(enquiryListQuerySchema.parse({ limit: "100" }), a)
  ).data;
  assert.equal(rows.find((r) => r.id === late.id)!.pastSla, true);
  assert.equal(rows.find((r) => r.id === answered.id)!.pastSla, false);
});

it("enquiry history is append-only", async () => {
  await fresh();
  const a = await member("support");
  const e = await make("other", a);
  // Each in its own savepoint: a refused statement aborts its transaction.
  await assert.rejects(
    withTransaction(
      () =>
        db()`UPDATE enquiry_event SET kind = 'note' WHERE enquiry_id = ${e.id}`,
    ),
    /append-only/,
  );
  await assert.rejects(
    withTransaction(
      () => db()`DELETE FROM enquiry_event WHERE enquiry_id = ${e.id}`,
    ),
    /append-only/,
  );
});
