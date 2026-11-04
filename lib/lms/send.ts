import { createHmac } from "node:crypto";

// CRM → LMS notices: the signed HTTP client. Contract:
// docs/superpowers/specs/2026-11-04-crm-to-lms-handoff.md (§3 transport,
// §5 replies). The LMS endpoint is built by our own team in the LMS repo.
//
// Configuration (env):
//   LMS_HANDOFF_ENABLED  "true" to queue notices at all (lib/lms/notices.ts).
//                        Off by default, so merging this changes nothing
//                        until the LMS endpoint exists.
//   LMS_WEBHOOK_URL      the LMS endpoint, e.g. https://class.thelead.io/api/crm/events
//   LMS_WEBHOOK_SECRET   shared HMAC secret; never committed (public repo)

export type LmsNoticeKind =
  | "enrolment.confirmed"
  | "enrolment.cancelled"
  | "enrolment.transferred"
  | "class.updated"
  | "person.updated";

export type LmsMessage = {
  messageId: string;
  type: LmsNoticeKind;
  sentAt: string;
  data: Record<string, unknown>;
};

export type LmsReply = { status: number; body: Record<string, unknown> };

export type LmsSender = (message: LmsMessage) => Promise<LmsReply>;

type Env = Record<string, string | undefined>;

export const lmsHandoffEnabled = (env: Env = process.env): boolean =>
  (env.LMS_HANDOFF_ENABLED ?? "").trim().toLowerCase() === "true";

// `X-Lead-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`,
// the same shape Stripe uses, so the LMS side can copy a known pattern.
export function signLmsBody(
  body: string,
  secret: string,
  timestamp: number,
): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

const TIMEOUT_MS = 10_000;

// The real sender. Any non-2xx answer throws, so the outbox retries it with
// its usual backoff and dead-letters it after the last attempt (§5). The
// error message carries the status only, never the body we sent: it holds a
// student's name and email.
export function makeLmsSender(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): LmsSender {
  return async (message) => {
    const url = (env.LMS_WEBHOOK_URL ?? "").trim();
    const secret = (env.LMS_WEBHOOK_SECRET ?? "").trim();
    if (!url || !secret)
      throw new Error("LMS_WEBHOOK_URL and LMS_WEBHOOK_SECRET must be set");
    const body = JSON.stringify(message);
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lead-timestamp": String(timestamp),
        "x-lead-signature": signLmsBody(body, secret, timestamp),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok)
      throw new Error(`LMS answered ${res.status} to ${message.type}`);
    return { status: res.status, body: parsed };
  };
}
