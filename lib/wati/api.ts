import type {
  WatiContact,
  WatiConversation,
  WatiHistoryMessage,
  WatiReader,
} from "./history.ts";

// Read side of WATI's API v3 (docs.wati.io; shapes checked against the live
// API on 6 Nov). Bearer token; the host only, no tenant id. Paged with
// page_number (1-based) and page_size (100 at most); a 429 waits and retries.
// Errors carry the status only: a body can echo a phone number.

const PAGE = 100;

type Json = Record<string, unknown>;

export function watiReader(opts: {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
  pauseMs?: number;
}): WatiReader {
  const base = new URL(opts.host).origin;
  const doFetch = opts.fetchImpl ?? fetch;
  const pause = opts.pauseMs ?? 150;

  async function get(path: string): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(base + path, {
        headers: {
          Authorization: `Bearer ${opts.token.replace(/^Bearer\s+/i, "")}`,
          Accept: "application/json",
        },
      });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok)
        throw new Error(
          `WATI answered ${res.status} to ${path.split("?")[0].replace(/\/[0-9a-f]{24}\//, "/{id}/")}`,
        );
      if (pause) await new Promise((r) => setTimeout(r, pause));
      return (await res.json()) as Json;
    }
  }

  // Every page of a list, newest first as WATI returns it.
  async function all(path: string, key: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let page = 1; ; page++) {
      const body = await get(
        `${path}${path.includes("?") ? "&" : "?"}page_number=${page}&page_size=${PAGE}`,
      );
      const items = body[key];
      if (!Array.isArray(items))
        throw new Error(`WATI list ${path.split("?")[0]} has no "${key}"`);
      out.push(...(items as Json[]));
      if (items.length < PAGE) return out;
    }
  }

  const s = (v: unknown) => (typeof v === "string" && v ? v : null);

  return {
    contacts: async () =>
      (await all("/api/ext/v3/contacts", "contact_list")).map(
        (c): WatiContact => ({
          id: String(c.id),
          waId: s(c.wa_id),
          phone: s(c.phone),
          name: s(c.name),
        }),
      ),
    conversations: async () =>
      (
        await all(
          "/api/ext/v3/conversations?channel_type=whatsapp",
          "conversation_list",
        )
      ).map((c): WatiConversation => ({
        id: String(c.id),
        contactId: String(c.contact_id),
        lastUpdated: String(c.last_updated),
      })),
    messages: async (conversationId) =>
      (
        await all(
          `/api/ext/v3/conversations/${encodeURIComponent(conversationId)}/messages`,
          "message_list",
        )
      ).map((m): WatiHistoryMessage => ({
        id: String(m.id),
        eventType: String(m.event_type ?? ""),
        owner: m.owner === true,
        type: String(m.type ?? ""),
        text: s(m.text),
        status: s(m.status),
        timestamp: String(m.timestamp ?? ""),
      })),
  };
}
