// Spec §9.13 against the database: the queue's order, the part_time clause in
// SQL, the SLA marker, the three writes, If-Match and their audit rows. Every
// test makes its own users, people and enquiries inside a rolled-back
// transaction and narrows the queue to them by a name only they carry, so
// nothing here depends on seed data. Skipped without DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import { forbidden } from "../lib/api/errors.ts";
import { permissionFor, type Viewer } from "../lib/auth/permissions.ts";
import { listEnquiries } from "../lib/enquiries/list.ts";
import {
  assignEnquiry,
  closeEnquiry,
  setEnquiryCategory,
} from "../lib/enquiries/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enquiryListQuerySchema } from "../lib/validation/enquiry-query.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

// Letters only: digits in a search would also be matched against phones.
const tag = () =>
  `Enqtest ${crypto
    .randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 12)}`;

type Seed = {
  status?: string;
  assignedTo?: string | null;
  // Postgres intervals before the transaction's now(); null leaves it unset.
  messageAgo?: string | null;
  responseAfter?: string | null;
  createdAgo?: string;
};

async function newEnquiry(personId: string, s: Seed = {}): Promise<string> {
  const sql = db();
  const [e] = await sql`
    INSERT INTO enquiry (person_id, channel, status, assigned_user_id,
                         created_at, first_message_at, first_response_at)
    VALUES (
      ${personId}, 'whatsapp', ${s.status ?? "open"}, ${s.assignedTo ?? null},
      now() - ${s.createdAgo ?? "0 minutes"}::interval,
      ${s.messageAgo === null ? null : sql`now() - ${s.messageAgo ?? "10 minutes"}::interval`},
      ${s.responseAfter ? sql`now() - ${s.messageAgo ?? "10 minutes"}::interval + ${s.responseAfter}::interval` : null}
    )
    RETURNING id`;
  return e.id as string;
}

const list = (viewer: Viewer, q: Record<string, string>) =>
  listEnquiries(enquiryListQuerySchema.parse(q), viewer);

const versionOf = async (id: string) =>
  Number((await db()`SELECT version FROM enquiry WHERE id = ${id}`)[0].version);

const auditRows = (id: string) =>
  db()`SELECT user_id, before, after FROM audit_log
       WHERE entity = 'enquiry' AND entity_id = ${id} AND action = 'update'`;

const setSla = (minutes: number) =>
  db()`INSERT INTO app_setting (key, value)
       VALUES ('first_response_sla_minutes', ${db().json(minutes)})
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

// --- The queue ----------------------------------------------------------

it("the default view is open enquiries, longest-waiting first", async () => {
  const support = await newUser("support");
  const name = tag();
  const person = await newPerson(name);
  const oldest = await newEnquiry(person, { messageAgo: "3 hours" });
  // No first message: waits from when it was created.
  const noMessage = await newEnquiry(person, {
    messageAgo: null,
    createdAgo: "2 hours",
  });
  const newest = await newEnquiry(person, { messageAgo: "1 hour" });
  const closed = await newEnquiry(person, {
    status: "closed",
    messageAgo: "5 hours",
  });

  const open = await list(support, { q: name });
  assert.deepEqual(
    open.data.map((r) => r.id),
    [oldest, noMessage, newest],
  );
  assert.equal(open.page.total, 3);
  const row = open.data[1];
  assert.equal(row.firstMessageAt, null);
  assert.equal(row.waitedMinutes, 120);

  const all = await list(support, { q: name, status: "all" });
  assert.deepEqual(
    all.data.map((r) => r.id),
    [closed, oldest, noMessage, newest],
  );
});

it("sort=-age puts the shortest wait first, with the same total", async () => {
  const support = await newUser("support");
  const name = tag();
  const person = await newPerson(name);
  const a = await newEnquiry(person, { messageAgo: "3 hours" });
  const b = await newEnquiry(person, { messageAgo: "1 hour" });
  const sorted = await list(support, { q: name, sort: "-age" });
  assert.deepEqual(
    sorted.data.map((r) => r.id),
    [b, a],
  );
  assert.equal(sorted.page.total, 2);
});

it("a part-timer's queue holds only what is assigned to them", async () => {
  const partTimer = await newUser("part_time");
  const other = await newUser("support");
  const name = tag();
  const person = await newPerson(name);
  const theirs = await newEnquiry(person, { assignedTo: partTimer.id });
  await newEnquiry(person, { assignedTo: other.id });
  await newEnquiry(person);

  const queue = await list(partTimer, { q: name });
  assert.deepEqual(
    queue.data.map((r) => r.id),
    [theirs],
  );
  assert.equal(queue.page.total, 1);

  // Naming someone else does not widen it.
  const asked = await list(partTimer, { q: name, assignee: other.id });
  assert.equal(asked.data.length, 0);
  assert.equal(asked.page.total, 0);
});

it("unassigned and mine narrow the queue", async () => {
  const support = await newUser("support");
  const name = tag();
  const person = await newPerson(name);
  const mine = await newEnquiry(person, { assignedTo: support.id });
  const nobody = await newEnquiry(person);
  assert.deepEqual(
    (await list(support, { q: name, assignee: "unassigned" })).data.map(
      (r) => r.id,
    ),
    [nobody],
  );
  assert.deepEqual(
    (await list(support, { q: name, mine: "true" })).data.map((r) => r.id),
    [mine],
  );
});

it("past-SLA rows follow the setting, the wait and the reply", async () => {
  const support = await newUser("support");
  await setSla(60);
  const name = tag();
  const person = await newPerson(name);
  const over = await newEnquiry(person, { messageAgo: "61 minutes" });
  const at = await newEnquiry(person, { messageAgo: "60 minutes" });
  const quickReply = await newEnquiry(person, {
    messageAgo: "7 days",
    responseAfter: "10 minutes",
  });
  const slowReply = await newEnquiry(person, {
    messageAgo: "7 days",
    responseAfter: "3 hours",
  });
  const ninety = await newEnquiry(person, { messageAgo: "90 minutes" });

  const late = async () =>
    new Map(
      (await list(support, { q: name })).data.map((r) => [r.id, r.pastSla]),
    );
  const at60 = await late();
  assert.equal(at60.get(over), true);
  assert.equal(at60.get(at), false);
  assert.equal(at60.get(quickReply), false);
  assert.equal(at60.get(slowReply), true);
  assert.equal(at60.get(ninety), true);

  await setSla(120);
  assert.equal((await late()).get(ninety), false);
});

it("marketing is refused the queue with one audited denial", async () => {
  const marketing = await newUser("marketing");
  assert.equal(permissionFor(marketing, "enquiry", "read").allowed, false);
  await assert.rejects(list(marketing, {}));
  const res = await forbidden(
    marketing,
    new Request("http://localhost/api/enquiries"),
    { what: "enquiries", resource: "enquiry" },
  );
  assert.equal(res.status, 403);
  const rows = await db()`
    SELECT entity FROM audit_log
    WHERE user_id = ${marketing.id} AND action = 'permission_denied'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, "enquiry");
});

// --- The writes ---------------------------------------------------------

it("assign to me writes one audit row with the old and new assignee", async () => {
  const support = await newUser("support");
  const id = await newEnquiry(await newPerson(tag()));
  const result = await assignEnquiry(id, "me", await versionOf(id), support);
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.enquiry.assignedUserId, support.id);
    assert.equal(result.enquiry.assigneeName, "Test user");
  }
  const audits = await auditRows(id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].user_id, support.id);
  assert.deepEqual(audits[0].before, { assigned_user_id: null });
  assert.deepEqual(audits[0].after, { assigned_user_id: support.id });
});

it("clearing an assignment leaves the enquiry unassigned", async () => {
  const admin = await newUser("super_admin");
  const support = await newUser("support");
  const name = tag();
  const id = await newEnquiry(await newPerson(name), {
    assignedTo: support.id,
  });
  const result = await assignEnquiry(id, null, await versionOf(id), admin);
  assert.equal(result.kind, "ok");
  const queue = await list(admin, { q: name, assignee: "unassigned" });
  assert.deepEqual(
    queue.data.map((r) => r.id),
    [id],
  );
});

it("a deactivated user cannot be given work; an active one can", async () => {
  const support = await newUser("support");
  const gone = await newUser("support");
  await db()`UPDATE app_user SET is_active = false WHERE id = ${gone.id}`;
  const active = await newUser("support");
  const id = await newEnquiry(await newPerson(tag()));

  const refused = await assignEnquiry(
    id,
    gone.id,
    await versionOf(id),
    support,
  );
  assert.equal(refused.kind, "inactive_user");
  const [row] =
    await db()`SELECT assigned_user_id FROM enquiry WHERE id = ${id}`;
  assert.equal(row.assigned_user_id, null);
  assert.equal((await auditRows(id)).length, 0);

  const ok = await assignEnquiry(id, active.id, await versionOf(id), support);
  assert.equal(ok.kind, "ok");
});

it("setting a category is recorded with before and after", async () => {
  const support = await newUser("support");
  const id = await newEnquiry(await newPerson(tag()));
  const result = await setEnquiryCategory(
    id,
    "hrdc",
    await versionOf(id),
    support,
  );
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") assert.equal(result.enquiry.category, "hrdc");
  const audits = await auditRows(id);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].before, { category: null });
  assert.deepEqual(audits[0].after, { category: "hrdc" });
});

it("closing stores the note, stamps the time, and a second close is 422", async () => {
  const support = await newUser("support");
  const name = tag();
  const id = await newEnquiry(await newPerson(name));
  const first = await closeEnquiry(
    id,
    { status: "human_resolved", note: "Sent the HRDC form" },
    await versionOf(id),
    support,
  );
  assert.equal(first.kind, "ok");
  const [closed] = await db()`
    SELECT status, summary, closed_at, handled_by FROM enquiry WHERE id = ${id}`;
  assert.equal(closed.status, "human_resolved");
  assert.equal(closed.summary, "Sent the HRDC form");
  assert.equal(closed.handled_by, "user");
  assert.ok(closed.closed_at);
  // It leaves the default view.
  assert.equal((await list(support, { q: name })).data.length, 0);

  const second = await closeEnquiry(
    id,
    { status: "closed", note: "Again" },
    await versionOf(id),
    support,
  );
  assert.equal(second.kind, "not_open");
  const [after] = await db()`
    SELECT status, summary, closed_at FROM enquiry WHERE id = ${id}`;
  assert.equal(after.status, "human_resolved");
  assert.equal(after.summary, "Sent the HRDC form");
  assert.equal(
    new Date(after.closed_at).getTime(),
    new Date(closed.closed_at).getTime(),
  );
  // One audit row: the first close, without the note's text (erasable data
  // must not reach the append-only audit_log).
  const audits = await auditRows(id);
  assert.equal(audits.length, 1);
  assert.deepEqual(Object.keys(audits[0].after).sort(), ["closed_at", "handled_by", "status"]);
  assert.equal(audits[0].after.status, "human_resolved");
  assert.equal(audits[0].after.handled_by, "user");
  assert.ok(audits[0].after.closed_at);
  assert.equal(audits[0].before.status, "open");
  assert.ok(!JSON.stringify(audits[0]).includes("Sent the HRDC form"));
});

it("a part-timer acts on their own enquiry and nobody else's", async () => {
  const partTimer = await newUser("part_time");
  const other = await newUser("support");
  const person = await newPerson(tag());
  const theirs = await newEnquiry(person, { assignedTo: partTimer.id });
  const othersOne = await newEnquiry(person, { assignedTo: other.id });
  const unassigned = await newEnquiry(person);

  assert.equal(
    (
      await setEnquiryCategory(
        theirs,
        "price",
        await versionOf(theirs),
        partTimer,
      )
    ).kind,
    "ok",
  );
  assert.equal(
    (
      await closeEnquiry(
        theirs,
        { status: "closed", note: "Answered on WhatsApp" },
        await versionOf(theirs),
        partTimer,
      )
    ).kind,
    "ok",
  );
  // Someone else's, or nobody's: refused as if it were not there.
  for (const id of [othersOne, unassigned]) {
    const v = await versionOf(id);
    assert.equal(
      (await setEnquiryCategory(id, "price", v, partTimer)).kind,
      "not_found",
    );
    assert.equal(
      (await closeEnquiry(id, { status: "closed", note: "x" }, v, partTimer))
        .kind,
      "not_found",
    );
    assert.equal(await versionOf(id), v);
  }
  // Cannot take unassigned work.
  assert.equal(
    (
      await assignEnquiry(
        unassigned,
        "me",
        await versionOf(unassigned),
        partTimer,
      )
    ).kind,
    "forbidden",
  );
  const [row] =
    await db()`SELECT assigned_user_id FROM enquiry WHERE id = ${unassigned}`;
  assert.equal(row.assigned_user_id, null);
});

it("read-only roles are refused every write", async () => {
  const id = await newEnquiry(await newPerson(tag()));
  for (const role of [
    "management",
    "sales",
    "operations",
    "marketing",
  ] as const) {
    const viewer = await newUser(role);
    const v = await versionOf(id);
    assert.equal(
      (await setEnquiryCategory(id, "price", v, viewer)).kind,
      "forbidden",
      role,
    );
    assert.equal(
      (await assignEnquiry(id, "me", v, viewer)).kind,
      "forbidden",
      role,
    );
    assert.equal(
      (await closeEnquiry(id, { status: "closed", note: "x" }, v, viewer)).kind,
      "forbidden",
      role,
    );
  }
  assert.equal((await auditRows(id)).length, 0);
});

it("a missing enquiry is 404 and a stale version on a real one is 409", async () => {
  const support = await newUser("support");
  assert.equal(
    (await setEnquiryCategory(crypto.randomUUID(), "price", 1, support)).kind,
    "not_found",
  );
  assert.equal(
    (await setEnquiryCategory("not-a-uuid", "price", 1, support)).kind,
    "not_found",
  );
  const id = await newEnquiry(await newPerson(tag()));
  assert.equal(
    (await setEnquiryCategory(id, "price", (await versionOf(id)) + 5, support))
      .kind,
    "stale",
  );
});

it("two triagers on one enquiry: the first wins, the second is stale and writes nothing", async () => {
  const first = await newUser("support");
  const second = await newUser("support");
  const id = await newEnquiry(await newPerson(tag()));
  const seen = await versionOf(id);

  assert.equal((await setEnquiryCategory(id, "hrdc", seen, first)).kind, "ok");
  assert.equal(
    (await setEnquiryCategory(id, "complaint", seen, second)).kind,
    "stale",
  );
  assert.equal(
    (await closeEnquiry(id, { status: "closed", note: "x" }, seen, second))
      .kind,
    "stale",
  );

  const [row] =
    await db()`SELECT category, status FROM enquiry WHERE id = ${id}`;
  assert.equal(row.category, "hrdc");
  assert.equal(row.status, "open");
  const audits = await auditRows(id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].user_id, first.id);
});
