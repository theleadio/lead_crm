// The inbox (lib/inbox/service.ts, moved from lead_sales with migration 019):
// who sees which conversations, filters, assignment and status, and "Make
// enquiry" with the deadline counted from the customer's message. Each test is
// rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  assignConversation,
  conversationDetail,
  listConversations,
  replyWindow,
  enquiryFromConversation,
  setConversationStatus,
} from "../lib/inbox/service.ts";
import { replyDueAt } from "../lib/enquiries/deadline.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

test("reply window: WhatsApp-like channels close 24 h after the customer's message", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const h = (n: number) => new Date(now.getTime() - n * 3600_000);
  assert.equal(replyWindow("whatsapp", h(23), now), "open");
  assert.equal(replyWindow("whatsapp", h(25), now), "closed");
  assert.equal(replyWindow("instagram", null, now), "closed");
  assert.equal(replyWindow("web_form", h(100), now), "not_applicable");
  assert.equal(replyWindow("email", h(100), now), "not_applicable");
});

// A conversation with one inbound message, as the help form makes it.
async function conversation(
  body: string,
  channel = "web_form",
  at = new Date(),
): Promise<{ id: string; personId: string }> {
  const personId = await newPerson("Inbox Customer");
  const thread = crypto.randomUUID();
  const [c] = await db()`
    INSERT INTO conversation (person_id, channel, external_thread_id,
                                    last_message_at, last_inbound_at)
    VALUES (${personId}, ${channel}, ${thread}, ${at}, ${at}) RETURNING id`;
  await db()`
    INSERT INTO conversation_message (conversation_id, person_id, channel, direction,
                               external_message_id, body, sent_at)
    VALUES (${c.id}, ${personId}, ${channel}, 'in', ${thread}, ${body}, ${at})`;
  return { id: c.id as string, personId };
}

it("support sees every conversation, with a preview and 'needs reply'", async () => {
  const agent = await newUser("support");
  const c = await conversation("Where is my e-invoice for March?");
  const list = await listConversations(agent, { status: "all" });
  const item = list.find((i) => i.id === c.id);
  assert.ok(item);
  assert.equal(item.lastDirection, "in");
  assert.match(item.preview!, /e-invoice/);
  const d = await conversationDetail(agent, c.id);
  assert.ok(d);
  assert.equal(d.messages.length, 1);
  assert.equal(d.suggestedCategory, "einvoice", "keywords suggest a category");
  assert.equal(d.replyWindow, "not_applicable");
});

it("other roles see only conversations tied to their team's enquiries; refusals audited", async () => {
  await db()`DELETE FROM team_member`;
  await db()`DELETE FROM enquiry_rule`;
  const ops = await newUser("operations");
  const [team] = await db()`SELECT id FROM team WHERE code = 'operations'`;
  await db()`INSERT INTO team_member (team_id, user_id) VALUES (${team.id}, ${ops.id})`;
  const agent = await newUser("support");
  const mine = await conversation("Class venue question");
  const other = await conversation("Something else");
  assert.equal(await conversationDetail(ops, mine.id), null, "no enquiry yet");

  await db()`
    INSERT INTO enquiry_category (code, label_en, team_id, position)
    VALUES ('venue', 'Venue', ${team.id}, 60) ON CONFLICT (code) DO NOTHING`;
  const made = await enquiryFromConversation(agent, mine.id, {
    category: "venue",
    subject: "Venue",
  });
  assert.equal(made.kind, "ok");
  assert.ok(
    await conversationDetail(ops, mine.id),
    "visible through its enquiry",
  );
  const ids = (await listConversations(ops, { status: "all" })).map(
    (i) => i.id,
  );
  assert.ok(ids.includes(mine.id));
  assert.ok(!ids.includes(other.id));

  assert.equal(
    (await setConversationStatus(ops, other.id, "closed")).kind,
    "not_found",
  );
  const [denied] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity = 'conversation'
      AND entity_id = ${other.id} AND user_id = ${ops.id}`;
  assert.ok(denied, "kept after the rollback");
});

it("assign and close; filters by assignee, status and channel", async () => {
  const agent = await newUser("support");
  const sales = await newUser("sales");
  const finance = await newUser("operations");
  const c = await conversation("Hello", "whatsapp");
  assert.equal((await assignConversation(agent, c.id, sales.id)).kind, "ok");
  const refused = await assignConversation(agent, c.id, finance.id);
  assert.equal(refused.kind, "invalid");
  if (refused.kind === "invalid")
    assert.match(refused.message, /support, sales, management or super admin/);
  let mine = await listConversations(sales, { who: "mine", status: "all" });
  assert.ok(mine.some((i) => i.id === c.id));
  const unassigned = await listConversations(agent, {
    who: "unassigned",
    status: "all",
  });
  assert.ok(!unassigned.some((i) => i.id === c.id));
  const forms = await listConversations(agent, {
    channel: "web_form",
    status: "all",
  });
  assert.ok(!forms.some((i) => i.id === c.id));

  await setConversationStatus(agent, c.id, "closed");
  assert.ok(
    !(await listConversations(agent, {})).some((i) => i.id === c.id),
    "open by default",
  );
  mine = await listConversations(sales, { who: "mine", status: "closed" });
  assert.ok(mine.some((i) => i.id === c.id));
  const [a] = await db()`
    SELECT count(*)::int AS n FROM audit_log
    WHERE entity = 'conversation' AND entity_id = ${c.id} AND action = 'update'`;
  assert.equal(a.n, 2);
});

it("make enquiry: linked to the conversation, deadline from the customer's message", async () => {
  await db()`DELETE FROM enquiry_rule`;
  const agent = await newUser("support");
  const askedAt = new Date("2026-11-06T17:00:00+08:00"); // Fri, after hours
  const c = await conversation("Need my receipt", "whatsapp", askedAt);
  const t = await enquiryFromConversation(agent, c.id, {
    category: "receipt",
    subject: "Need my receipt",
  });
  assert.equal(t.kind, "ok");
  if (t.kind !== "ok") return;
  const [row] = await db()`
    SELECT conversation_id, channel, person_id, sla_due_at
    FROM enquiry WHERE id = ${t.enquiry.id}`;
  assert.equal(row.conversation_id, c.id);
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.person_id, c.personId);
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM holiday
    WHERE day BETWEEN '2026-11-06' AND '2026-11-12'`;
  if (n === 0)
    assert.deepEqual(
      row.sla_due_at,
      replyDueAt(askedAt, new Set()),
      "Tue 8:30, not a day from now",
    );
  const d = await conversationDetail(agent, c.id);
  assert.equal(d!.enquiries.length, 1, "shown in the thread");
  // Finance is restricted: the agent sees that it exists, not what it says.
  assert.equal(d!.enquiries[0].canOpen, false);
  assert.equal(d!.enquiries[0].subject, null);
  assert.equal(d!.enquiries[0].teamName, "Finance");
});
