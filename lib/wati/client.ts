// Sending through WATI API v3 (docs.wati.io): the pieces the inbox reply
// (send.ts) and the after-hours auto-reply (auto-reply.ts) share. Host only,
// Bearer token. Errors carry the status only: a body can echo the phone
// number.

export type WatiOpts = {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
};

async function post(o: WatiOpts, path: string, body: unknown): Promise<void> {
  const res = await (o.fetchImpl ?? fetch)(new URL(o.host).origin + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${o.token.replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WATI answered ${res.status}`);
  // WATI can answer 200 with result:false.
  const json = (await res.json().catch(() => null)) as {
    result?: unknown;
  } | null;
  if (json && json.result === false)
    throw new Error("WATI refused the message");
}

// Free text to a WhatsApp number (digits), inside the 24-hour window.
export const sendText = (o: WatiOpts, to: string, text: string) =>
  post(o, "/api/ext/v3/conversations/messages/text", { target: to, text });

// From env, or none (no reply box, no auto-reply).
export function watiFromEnv(): WatiOpts | undefined {
  const host = process.env.WATI_API_HOST;
  const token = process.env.WATI_API_TOKEN;
  return host && token ? { host, token } : undefined;
}
