// Spec §7 status codes and §13 wording for every way a §9.12 save can end.
// §9.12 is explicit that a repeat submit reads "already recorded" — so no
// message here may leak an index name, a constraint or a SQLSTATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import type { PaymentWriteResult } from "../lib/payments/service.ts";
import { paymentWriteResponse } from "../lib/payments/write-response.ts";

const viewer: Viewer = {
  id: "00000000-0000-4000-8000-0000000000ff",
  role: "operations",
};
const request = new Request("http://localhost/api/payments/manual", {
  method: "POST",
});

// Every result kind the service can return except `forbidden`, which writes an
// audit row and so is checked against the database in `payments-permissions`.
// The switch in write-response.ts is exhaustive over the union, so a new kind
// fails the typecheck; this list is what proves each one carries a message.
const results: PaymentWriteResult[] = [
  {
    kind: "ok",
    payment: {
      paymentId: "00000000-0000-4000-8000-00000000000a",
      enrolmentId: "00000000-0000-4000-8000-00000000000b",
      method: "bank_transfer",
      amountMyr: "3200.00",
      version: 2,
      statusMoved: true,
      status: "confirmed",
    },
  },
  { kind: "not_found" },
  { kind: "stale" },
  { kind: "blocked_status", status: "cancelled" },
  { kind: "no_seats", classCode: "AIM-2026-01" },
  { kind: "already_recorded" },
  { kind: "proof_not_yours" },
  { kind: "proof_missing" },
  {
    kind: "proof_rejected",
    check: { ok: false, reason: "too_large", bytes: 14680064, limit: 10485760 },
  },
  { kind: "proof_rejected", check: { ok: false, reason: "empty" } },
  {
    kind: "proof_rejected",
    check: { ok: false, reason: "unsupported_type" },
  },
];

const body = async (result: PaymentWriteResult) => {
  const response = await paymentWriteResponse(result, viewer, request);
  return { status: response.status, json: await response.json() };
};

test("every result kind answers with a status code and a message", async () => {
  for (const result of results) {
    const { status, json } = await body(result);
    assert.equal(typeof status, "number", result.kind);
    if (result.kind === "ok") {
      assert.equal(status, 201);
      assert.equal(json.statusMoved, true);
      continue;
    }
    assert.ok(status >= 400, `${result.kind} should be an error status`);
    assert.equal(typeof json.error?.code, "string", result.kind);
    assert.ok(
      json.error?.message?.length > 0,
      `${result.kind} needs a message`,
    );
  }
});

test("the status codes are the ones §7 asks for", async () => {
  const expected: [PaymentWriteResult["kind"], number][] = [
    ["not_found", 404],
    ["stale", 409],
    ["blocked_status", 422],
    ["no_seats", 409],
    ["already_recorded", 409],
    ["proof_not_yours", 400],
    ["proof_missing", 400],
    ["proof_rejected", 400],
  ];
  for (const [kind, code] of expected) {
    const result = results.find((r) => r.kind === kind)!;
    assert.equal((await body(result)).status, code, kind);
  }
});

test("no message leaks a database detail", async () => {
  for (const result of results) {
    const { json } = await body(result);
    const message: string = json.error?.message ?? "";
    for (const leak of [
      "payment_proof_key_uq",
      "constraint",
      "SQLSTATE",
      "23505",
      "P0001",
      "duplicate key",
      "index",
    ]) {
      assert.equal(
        message.toLowerCase().includes(leak.toLowerCase()),
        false,
        `${result.kind} leaks "${leak}": ${message}`,
      );
    }
  }
});

test("a repeat submit reads as work already done", async () => {
  const { status, json } = await body({ kind: "already_recorded" });
  assert.equal(status, 409);
  assert.equal(json.error.code, "already_recorded");
  assert.match(json.error.message, /already recorded/i);
});

// §13: "That file is 14MB. The limit is 10MB — try a photo instead of a scan."
test("an over-large proof names both numbers", async () => {
  const { json } = await body({
    kind: "proof_rejected",
    check: { ok: false, reason: "too_large", bytes: 14680064, limit: 10485760 },
  });
  assert.match(json.error.message, /14MB/);
  assert.match(json.error.message, /10MB/);
  // The modal highlights the field it belongs to (§9 cross-screen).
  assert.equal(typeof json.error.proofKey, "undefined");
  assert.match(json.error.fields.proofKey, /14MB/);
});

test("a blocked status names the status that refused it", async () => {
  const { json } = await body({ kind: "blocked_status", status: "cancelled" });
  assert.match(json.error.message, /cancelled/i);
});

test("no seats names the class", async () => {
  const { json } = await body({
    kind: "no_seats",
    classCode: "AIM-2026-01",
  });
  assert.match(json.error.message, /AIM-2026-01/);
});
