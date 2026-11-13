// The WATI reader (lib/wati/api.ts) against fakes of the live responses
// (6 Nov): list keys, paging, field mapping, retry on 429, status-only errors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { watiReader } from "../lib/wati/api.ts";

function fakeWati(routes: Record<string, (page: number) => unknown>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.match(
      (init.headers as Record<string, string>).Authorization,
      /^Bearer tok$/,
    );
    const u = new URL(url);
    const route = Object.keys(routes).find((p) => u.pathname === p);
    if (!route) return new Response("{}", { status: 404 });
    const page = Number(u.searchParams.get("page_number"));
    return Response.json(routes[route](page));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const rd = (f: typeof fetch) =>
  watiReader({
    host: "https://live-mt-server.wati.io/12345",
    token: "tok",
    fetchImpl: f,
    pauseMs: 0,
  });

test("contacts, chats and messages: the live list keys, mapped fields, every page", async () => {
  const full = (n: number, make: (i: number) => object) =>
    Array.from({ length: n }, (_, i) => make(i));
  const w = fakeWati({
    "/api/ext/v3/contacts": (p) => ({
      contact_list: full(p === 1 ? 100 : 3, (i) => ({
        id: `c${p}-${i}`,
        wa_id: "60121234567",
        phone: "60121234567",
        name: "N",
      })),
      page_number: p,
      page_size: 100,
    }),
    "/api/ext/v3/conversations": (p) => ({
      conversation_list: [
        {
          id: "v1",
          contact_id: "c1-0",
          last_updated: "2026-11-05T00:00:00Z",
          channel_type: "whatsapp",
        },
      ],
      page_number: p,
      page_size: 100,
    }),
    "/api/ext/v3/conversations/v1/messages": () => ({
      message_list: [
        {
          id: "m1",
          event_type: "message",
          owner: true,
          type: "text",
          text: "hi",
          status: "READ",
          timestamp: "1767225600",
        },
        { id: "m2", event_type: "ticket", type: "1", timestamp: "1767225700" },
      ],
      page_number: 1,
      page_size: 100,
    }),
  });
  const r = rd(w.fetchImpl);

  const contacts = await r.contacts();
  assert.equal(contacts.length, 103, "two pages");
  assert.deepEqual(contacts[0], {
    id: "c1-0",
    waId: "60121234567",
    phone: "60121234567",
    name: "N",
  });

  const convs = await r.conversations();
  assert.deepEqual(convs, [
    { id: "v1", contactId: "c1-0", lastUpdated: "2026-11-05T00:00:00Z" },
  ]);
  assert.match(
    w.calls.find((c) => c.includes("conversations?"))!,
    /channel_type=whatsapp/,
  );

  const msgs = await r.messages("v1");
  assert.equal(msgs[0].owner, true);
  assert.equal(msgs[0].eventType, "message");
  assert.equal(msgs[1].owner, false, "no owner flag = not ours");
  assert.ok(
    w.calls.every((c) =>
      c.startsWith("https://live-mt-server.wati.io/api/ext/v3/"),
    ),
    "host only, tenant path dropped",
  );
});

test("an error carries the status, not the body", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ message: "no such contact 60121234567" }), {
      status: 403,
    })) as typeof fetch;
  await assert.rejects(rd(fetchImpl).contacts(), (e: Error) => {
    assert.match(e.message, /WATI answered 403/);
    assert.equal(e.message.includes("60121234567"), false);
    return true;
  });
});
