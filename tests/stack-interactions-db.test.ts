// Where Shawn's pre-freeze migration (009) meets Zixuan's manual-payment code
// (9.12, migration 008): the payment CHECKs, the enrolment history trigger and
// the one-proof-one-payment index all fire on the same save. Rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import { recordManualPayment } from "../lib/payments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import type { PaymentManualBody } from "../lib/validation/payment.ts";
import { enrol, it, newClass, newUser } from "./seed.ts";

after(closeDb);

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const storedPdf = async () => PDF;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

const body = (
  enrolmentId: string,
  over: Partial<PaymentManualBody> = {},
): PaymentManualBody => ({
  enrolmentId,
  method: "bank_transfer",
  amountMyr: "3200.00",
  referenceNo: "FT24100912345",
  paidOn: today(),
  proofKey: `${enrolmentId}/${crypto.randomUUID()}`,
  ...over,
});

const version = async (id: string) =>
  Number(
    (await db()`SELECT version FROM enrolment WHERE id = ${id}`)[0].version,
  );

const history = async (id: string) =>
  await db()`
    SELECT from_status, to_status, reason FROM enrolment_status_history
    WHERE enrolment_id = ${id} ORDER BY changed_at, id`;

it("a manual payment that confirms an enrolment leaves one history row and a paid_at the CHECK accepts", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending", {
    pricePaid: "3200.00",
  });
  const before = (await history(id)).length;

  const r = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(r.kind, "ok");

  const rows = await history(id);
  assert.equal(rows.length, before + 1);
  assert.deepEqual(
    { from: rows.at(-1)?.from_status, to: rows.at(-1)?.to_status },
    { from: "payment_pending", to: "confirmed" },
  );
  const [p] = await db()`
    SELECT p.paid_at, n.net_myr::text AS net
    FROM payment p JOIN payment_net n ON n.id = p.id
    WHERE p.enrolment_id = ${id}`;
  assert.ok(p.paid_at);
  assert.equal(p.net, "3200.00");
});

it("a late payment on a confirmed enrolment leaves its history alone", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "confirmed", {
    pricePaid: "3200.00",
  });
  const before = (await history(id)).length;

  const r = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await history(id)).length, before);
});

it("a repeated proof is refused and the rollback takes the history row with it", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending", {
    pricePaid: "3200.00",
  });
  const sent = body(id);
  assert.equal(
    (await recordManualPayment(sent, await version(id), viewer, storedPdf))
      .kind,
    "ok",
  );
  // Back to payment_pending so the second save would try to move the status.
  await db()`UPDATE enrolment SET status = 'payment_pending' WHERE id = ${id}`;
  const rows = (await history(id)).length;

  const again = await recordManualPayment(
    sent,
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(again.kind, "already_recorded");
  assert.equal((await history(id)).length, rows);
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM payment WHERE enrolment_id = ${id}`;
  assert.equal(n, 1);
});
