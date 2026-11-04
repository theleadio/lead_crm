// The CRM -> LMS client (lib/lms/send.ts), without a database: signing, the
// on/off switch, and what a failure says.
import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  lmsHandoffEnabled,
  makeLmsSender,
  signLmsBody,
  type LmsMessage,
} from "../lib/lms/send.ts";

const message: LmsMessage = {
  messageId: "00000000-0000-4000-8000-000000000001",
  type: "enrolment.cancelled",
  sentAt: "2026-11-04T00:00:00.000Z",
  data: { enrolmentId: "e1", reason: "student_withdrew", email: "a@b.test" },
};

const env = {
  LMS_WEBHOOK_URL: "https://lms.example.test/api/crm/events",
  LMS_WEBHOOK_SECRET: "lms_secret",
};

test("signature is v1=<hex HMAC-SHA256 of '<timestamp>.<body>'>", () => {
  const expected = createHmac("sha256", "s").update("123.{}").digest("hex");
  assert.equal(signLmsBody("{}", "s", 123), `v1=${expected}`);
});

test("the switch is off unless LMS_HANDOFF_ENABLED is exactly true (any case)", () => {
  assert.equal(lmsHandoffEnabled({}), false);
  assert.equal(lmsHandoffEnabled({ LMS_HANDOFF_ENABLED: "1" }), false);
  assert.equal(lmsHandoffEnabled({ LMS_HANDOFF_ENABLED: "TRUE " }), true);
});

test("sends the JSON body with headers the LMS can verify", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;

  const reply = await makeLmsSender(env, fake)(message);
  assert.equal(reply.status, 200);
  assert.equal(seen!.url, env.LMS_WEBHOOK_URL);
  const h = seen!.init.headers as Record<string, string>;
  const body = seen!.init.body as string;
  assert.deepEqual(JSON.parse(body), message);
  assert.equal(
    h["x-lead-signature"],
    signLmsBody(body, env.LMS_WEBHOOK_SECRET, Number(h["x-lead-timestamp"])),
  );
});

test("a non-2xx answer throws, naming the status but not the student", async () => {
  const fake = (async () =>
    new Response("{}", { status: 422 })) as unknown as typeof fetch;
  await assert.rejects(makeLmsSender(env, fake)(message), (err: Error) => {
    assert.match(err.message, /422/);
    assert.doesNotMatch(err.message, /a@b\.test/);
    return true;
  });
});

test("refuses to send without URL and secret", async () => {
  await assert.rejects(makeLmsSender({}, fetch)(message), /must be set/);
});
