// Spec §9.12, §14, §6: who may read a payment's proof, and that every read
// leaves a `view` audit row. The signed URL itself is the object store's —
// what is checked here is the gate in front of it and the audit behind it.
import { after } from "node:test";
import assert from "node:assert/strict";
import { readPaymentProof } from "../lib/payments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newUser, pay } from "./seed.ts";

after(closeDb);

// The gate and the audit row are what this file checks, not the object store.
// Unsetting the bucket makes signing throw on purpose, so a read that got past
// the gate is visible as a rejection whether or not a bucket exists on the
// machine running these tests.
delete process.env.PAYMENT_PROOF_BUCKET;

const views = async (paymentId: string) =>
  await db()`
    SELECT user_id FROM audit_log
    WHERE entity = 'payment' AND entity_id = ${paymentId} AND action = 'view'`;

// A payment on an enrolment whose deal belongs to `ownerId`, so the §6
// sales-own-deals rule has something to judge.
async function paymentOnOwnedDeal(ownerId: string | null): Promise<string> {
  const sql = db();
  const courseId = await newCourse();
  const classId = await newClass({ courseId });
  const enrolmentId = await enrol(classId, "confirmed");
  if (ownerId !== null) {
    const [{ person_id: personId }] = await sql`
      SELECT person_id FROM enrolment WHERE id = ${enrolmentId}`;
    const [deal] = await sql`
      INSERT INTO deal (pipeline, stage, person_id, course_id, owner_user_id)
      VALUES ('individual', 'engaged', ${personId}, ${courseId}, ${ownerId})
      RETURNING id`;
    await sql`
      UPDATE enrolment SET deal_id = ${deal.id} WHERE id = ${enrolmentId}`;
  }
  return pay(enrolmentId);
}

it("a role with no payment access reads no proof and gets no URL", async () => {
  const paymentId = await paymentOnOwnedDeal(null);
  for (const role of ["support", "marketing", "part_time"] as const) {
    const viewer = await newUser(role);
    assert.deepEqual(
      await readPaymentProof(paymentId, viewer),
      { kind: "forbidden" },
      role,
    );
  }
  assert.equal((await views(paymentId)).length, 0);
});

it("sales reads a proof only on a deal they own", async () => {
  const sales = await newUser("sales");
  const other = await newUser("sales");

  const theirs = await paymentOnOwnedDeal(sales.id);
  const someoneElses = await paymentOnOwnedDeal(other.id);
  const noDeal = await paymentOnOwnedDeal(null);

  // §6 footnote 2. The owned one reaches the store, which is not configured in
  // a test run — so the gate passing is what is asserted, by the refusal that
  // does *not* come back.
  await assert.rejects(() => readPaymentProof(theirs, sales));
  assert.deepEqual(await readPaymentProof(someoneElses, sales), {
    kind: "forbidden",
  });
  // No deal behind the payment means no owner to match, so it stays out of
  // their reach.
  assert.deepEqual(await readPaymentProof(noDeal, sales), {
    kind: "forbidden",
  });
});

it("a read by a permitted role is audited before the URL is minted", async () => {
  const paymentId = await paymentOnOwnedDeal(null);
  const viewer = await newUser("operations");

  // The store is not configured in a test run, so signing throws — but the
  // audit row is written first, which is the §6 rule being checked. A read
  // that reached the store is a read that happened.
  await assert.rejects(() => readPaymentProof(paymentId, viewer));

  const rows = await views(paymentId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, viewer.id);
});

it("a payment with no proof is a 404, and nothing is audited", async () => {
  const viewer = await newUser("operations");
  const enrolmentId = await enrol(await newClass({}), "confirmed");
  const sql = db();
  // A Stripe payment carries no proof file (§5, migration 008 allows many).
  const [stripe] = await sql`
    INSERT INTO payment (enrolment_id, method, status, amount_myr, paid_at)
    VALUES (${enrolmentId}, 'stripe_card', 'succeeded', 100, now())
    RETURNING id`;

  assert.deepEqual(await readPaymentProof(stripe.id as string, viewer), {
    kind: "not_found",
  });
  assert.equal((await views(stripe.id as string)).length, 0);
});

it("an unknown or malformed payment id is a 404", async () => {
  const viewer = await newUser("operations");
  for (const id of [crypto.randomUUID(), "not-an-id"])
    assert.deepEqual(await readPaymentProof(id, viewer), {
      kind: "not_found",
    });
});
