// Sending through WATI API v3 (docs.wati.io): the pieces the inbox reply
// (send.ts) and the after-hours auto-reply (auto-reply.ts) share. Host only,
// Bearer token. Errors carry the status only: a body can echo the phone
// number.

export type WatiOpts = {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
};

// WATI said no (a 4xx, or result:false), or the host is not a valid
// address: the message was not sent, and sending it again won't help.
// Anything else thrown (timeout, 5xx, network) leaves it unknown whether
// WATI sent it.
export class WatiRefused extends Error {}

async function post(o: WatiOpts, path: string, body: unknown): Promise<void> {
  let origin: string;
  try {
    origin = new URL(o.host).origin;
  } catch {
    throw new WatiRefused("WATI_API_HOST is not a valid address");
  }
  const res = await (o.fetchImpl ?? fetch)(origin + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${o.token.replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 400 && res.status < 500)
    throw new WatiRefused(`WATI refused it (${res.status})`);
  if (!res.ok) throw new Error(`WATI answered ${res.status}`);
  // WATI can answer 200 with result:false.
  const json = (await res.json().catch(() => null)) as {
    result?: unknown;
  } | null;
  if (json && json.result === false)
    throw new WatiRefused("WATI refused the message");
}

// Free text to a WhatsApp number (digits), inside the 24-hour window.
export const sendText = (o: WatiOpts, to: string, text: string) =>
  post(o, "/api/ext/v3/conversations/messages/text", { target: to, text });

// An approved template to a WhatsApp number (digits), at any time. Our id goes
// to WATI as local_message_id, so its status events can find the row.
export const sendTemplate = (
  o: WatiOpts,
  to: string,
  template: string,
  localId: string,
  params: { name: string; value: string }[],
) =>
  post(o, "/api/ext/v3/messageTemplates/send", {
    template_name: template,
    broadcast_name: `${template}-${new Date().toISOString().slice(0, 10)}`,
    recipients: [
      { target: to, local_message_id: localId, custom_params: params },
    ],
  });

// From env, or none (no reply box, no auto-reply).
export function watiFromEnv(): WatiOpts | undefined {
  const host = process.env.WATI_API_HOST;
  const token = process.env.WATI_API_TOKEN;
  return host && token ? { host, token } : undefined;
}
