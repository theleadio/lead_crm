// Spec §9.12 Record manual payment, against the database: what one save
// writes, which §12.4 moves it causes, what refuses it, and migration 008's
// one-proof-one-payment rule. Each test runs in a transaction that is rolled
// back (`it` in ./seed.ts).
import { after } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { recordManualPayment } from "../lib/payments/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import type { PaymentManualBody } from "../lib/validation/payment.ts";
import { enrol, it, newClass, newCourse, newUser, pay } from "./seed.ts";

after(closeDb);

// A real PDF's leading bytes, standing in for the object the browser uploaded.
// The §14 check that reads them is the production one (design 3).
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const storedPdf = async () => PDF;
const storedNothing = async () => null;

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

function body(
  enrolmentId: string,
  over: Partial<PaymentManualBody> = {},
): PaymentManualBody {
  return {
    enrolmentId,
    method: "bank_transfer",
    amountMyr: "3200.00",
    referenceNo: "FT24100912345",
    paidOn: today(),
    proofKey: `${enrolmentId}/${crypto.randomUUID()}`,
    notes: "Paid from the company account",
    ...over,
  };
}

const enrolmentRow = async (id: string) => {
  const [r] = await db()`SELECT * FROM enrolment WHERE id = ${id}`;
  return r;
};

const version = async (id: string) => Number((await enrolmentRow(id)).version);

const paymentsOf = async (enrolmentId: string) =>
  await db()`
    SELECT * FROM payment WHERE enrolment_id = ${enrolmentId}
    ORDER BY created_at`;

const events = async (enrolmentId: string) =>
  (
    await db()`
      SELECT type, payload FROM event_outbox
      WHERE payload->>'enrolmentId' = ${enrolmentId}
      ORDER BY created_at`
  ).map((e) => ({ type: e.type as string, payload: e.payload }));

const auditRows = async (entity: string, entityId: string) =>
  await db()`
    SELECT action, before, after FROM audit_log
    WHERE entity = ${entity} AND entity_id = ${entityId}`;

// A class with a deal behind the enrolment, so the §6 sales rule and §12.5
// have something to read (design 10).
async function enrolmentWithDeal(status: string): Promise<{
  enrolmentId: string;
  dealId: string;
  classId: string;
}> {
  const sql = db();
  const courseId = await newCourse();
  const classId = await newClass({ courseId, priceMyr: "3200.00" });
  const enrolmentId = await enrol(classId, status, {
    pricePaid: "3200.00",
  });
  const [{ person_id: personId }] = await sql`
    SELECT person_id FROM enrolment WHERE id = ${enrolmentId}`;
  const [deal] = await sql`
    INSERT INTO deal (pipeline, stage, person_id, course_id, amount_myr)
    VALUES ('individual', 'engaged', ${personId}, ${courseId}, '3200.00')
    RETURNING id`;
  await sql`
    UPDATE enrolment SET deal_id = ${deal.id} WHERE id = ${enrolmentId}`;
  return { enrolmentId, dealId: deal.id as string, classId };
}

// ---------------------------------------------------------------- 6.2 the row

it("records the payment, confirms the enrolment, raises both events", async () => {
  const viewer = await newUser();
  const { enrolmentId, dealId } = await enrolmentWithDeal("payment_pending");
  const sent = body(enrolmentId);

  const result = await recordManualPayment(
    sent,
    await version(enrolmentId),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.payment.statusMoved, true);
  assert.equal(result.payment.status, "confirmed");
  assert.equal(result.payment.amountMyr, "3200.00");

  const [payment] = await paymentsOf(enrolmentId);
  assert.equal(payment.method, "bank_transfer");
  assert.equal(String(payment.amount_myr), "3200.00");
  assert.equal(payment.status, "succeeded");
  assert.equal(payment.match_status, "matched");
  assert.equal(payment.reference_no, sent.referenceNo);
  assert.equal(payment.proof_file_key, sent.proofKey);
  assert.equal(payment.notes, sent.notes);
  assert.equal(payment.recorded_by, viewer.id);
  assert.equal(payment.created_by, viewer.id);
  assert.equal(payment.currency, "MYR");
  assert.equal(String(payment.refunded_amount_myr), "0.00");
  // design 10: the deal travels with the payment, so §6 (sales see their own
  // deals' money) and §12.5 (won with money) both see this row.
  assert.equal(payment.deal_id, dealId);
  // §9.12 HRDC: paid_at is the day the money was received.
  assert.equal(
    new Date(payment.paid_at as string).toISOString().slice(0, 10),
    sent.paidOn,
  );

  assert.equal((await enrolmentRow(enrolmentId)).status, "confirmed");

  // §11.1: exact names, both in the same transaction as the money.
  const raised = await events(enrolmentId);
  assert.deepEqual(raised.map((e) => e.type).sort(), [
    "EnrolmentConfirmed",
    "PaymentRecorded",
  ]);
  const recorded = raised.find((e) => e.type === "PaymentRecorded")!;
  assert.deepEqual(recorded.payload, {
    paymentId: payment.id,
    enrolmentId,
    method: "bank_transfer",
    amountMyr: "3200.00",
  });
  const confirmed = raised.find((e) => e.type === "EnrolmentConfirmed")!;
  assert.equal(
    (confirmed.payload as { classId: string }).classId,
    (await enrolmentRow(enrolmentId)).class_id,
  );

  const paymentAudit = await auditRows("payment", payment.id as string);
  assert.equal(paymentAudit.length, 1);
  assert.equal(paymentAudit[0].action, "create");
  const enrolmentAudit = await auditRows("enrolment", enrolmentId);
  assert.equal(enrolmentAudit.length, 1);
  assert.equal(
    (enrolmentAudit[0].before as { status: string }).status,
    "payment_pending",
  );
  assert.equal(
    (enrolmentAudit[0].after as { status: string }).status,
    "confirmed",
  );
});

it("records a payment on an enrolment with no deal behind it", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");

  const result = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  const [payment] = await paymentsOf(id);
  assert.equal(payment.deal_id, null);
  assert.equal(payment.enrolment_id, id);
});

it("stores the notes as empty when none were given", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");
  const { notes, ...withoutNotes } = body(id);
  assert.ok(notes);

  await recordManualPayment(
    withoutNotes as PaymentManualBody,
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal((await paymentsOf(id))[0].notes, null);
});

// ------------------------------------------------- 6.3 the §9.12 Status rule

it("reserved and payment_pending move to confirmed", async () => {
  for (const from of ["reserved", "payment_pending"]) {
    const viewer = await newUser();
    const id = await enrol(await newClass({}), from);

    const result = await recordManualPayment(
      body(id),
      await version(id),
      viewer,
      storedPdf,
    );
    assert.equal(result.kind, "ok", from);
    if (result.kind !== "ok") return;
    assert.equal(result.payment.statusMoved, true, from);
    assert.equal((await enrolmentRow(id)).status, "confirmed", from);
    assert.deepEqual(
      (await events(id)).map((e) => e.type).sort(),
      ["EnrolmentConfirmed", "PaymentRecorded"],
      from,
    );
  }
});

it("a late payment is recorded and the status is left alone", async () => {
  // §9.12 Status: a late bank transfer on a student who is already confirmed
  // or onboarded, and the three other statuses that are not on §12.4's way to
  // confirmed either.
  for (const from of [
    "confirmed",
    "onboarded",
    "attended",
    "completed",
    "waitlisted",
  ]) {
    const viewer = await newUser();
    const id = await enrol(await newClass({}), from);

    const result = await recordManualPayment(
      body(id),
      await version(id),
      viewer,
      storedPdf,
    );
    assert.equal(result.kind, "ok", from);
    if (result.kind !== "ok") return;
    assert.equal(result.payment.statusMoved, false, from);
    assert.equal(result.payment.status, from, from);
    assert.equal((await enrolmentRow(id)).status, from, from);
    assert.equal((await paymentsOf(id)).length, 1, from);
    // No confirm event, because nothing was confirmed (§11.1).
    assert.deepEqual(
      (await events(id)).map((e) => e.type),
      ["PaymentRecorded"],
      from,
    );
    // The enrolment still has no audit row of its own — only the payment does.
    assert.equal((await auditRows("enrolment", id)).length, 0, from);
  }
});

it("cancelled, refunded and transferred refuse the payment", async () => {
  for (const from of ["cancelled", "refunded", "transferred"]) {
    const viewer = await newUser();
    const classId = await newClass({});
    const id = await enrol(classId, "confirmed");
    const sql = db();
    // `transferred` must name where it went (§5 CHECK), so give it a target.
    if (from === "transferred") {
      const target = await enrol(await newClass({}), "confirmed");
      await sql`
        UPDATE enrolment
        SET status = 'transferred', transferred_to_enrolment_id = ${target}
        WHERE id = ${id}`;
    } else {
      await sql`
        UPDATE enrolment SET status = ${from},
          cancelled_reason = ${from === "cancelled" ? "student withdrew" : null}
        WHERE id = ${id}`;
    }

    const result = await recordManualPayment(
      body(id),
      await version(id),
      viewer,
      storedPdf,
    );
    assert.deepEqual(result, { kind: "blocked_status", status: from }, from);
    assert.equal((await paymentsOf(id)).length, 0, from);
    assert.equal((await events(id)).length, 0, from);
  }
});

// ----------------------------------------------- 6.4 money and concurrency

it("keeps the amount exact and never rewrites the stored price", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({ priceMyr: "3200.00" }), "reserved", {
    pricePaid: "3200.00",
  });

  const result = await recordManualPayment(
    body(id, { amountMyr: "1234.55" }),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  assert.equal(String((await paymentsOf(id))[0].amount_myr), "1234.55");
  // §12.7: the snapshot taken at purchase does not follow a payment.
  assert.equal(String((await enrolmentRow(id)).price_paid_myr), "3200.00");
});

it("a part payment still confirms, because O16 is not built", async () => {
  // §9.12 Part payments: pending Finance (O16). Until the database owns that
  // rule, any accepted amount confirms a payment_pending enrolment, and this
  // test is what will fail when the rule lands — on purpose.
  const viewer = await newUser();
  const id = await enrol(
    await newClass({ priceMyr: "3200.00" }),
    "payment_pending",
    { pricePaid: "3200.00" },
  );

  const result = await recordManualPayment(
    body(id, { amountMyr: "100.00" }),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  assert.equal((await enrolmentRow(id)).status, "confirmed");
});

it("a stale version writes nothing, a late payment still bumps it", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "confirmed");
  const before = await version(id);

  assert.deepEqual(
    await recordManualPayment(body(id), before - 1, viewer, storedPdf),
    { kind: "stale" },
  );
  assert.equal((await paymentsOf(id)).length, 0);

  // design 6: the enrolment is touched even when the status does not move, so
  // the version the screen holds is consumed.
  const ok = await recordManualPayment(body(id), before, viewer, storedPdf);
  assert.equal(ok.kind, "ok");
  assert.equal(await version(id), before + 1);
  if (ok.kind === "ok") assert.equal(ok.payment.version, before + 1);
});

// --------------------------------------------------------- 6.5 seats (§12.1)

it("a payment cannot confirm a seat the class no longer has", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  // The reservation's hold ran out, so §12.1 says it holds no seat; someone
  // else took the last one in the meantime.
  const expired = await enrol(classId, "reserved", {
    reservedOffset: "-1 hours",
  });
  await enrol(classId, "confirmed");

  const result = await recordManualPayment(
    body(expired),
    await version(expired),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "no_seats");
  if (result.kind === "no_seats") assert.ok(result.classCode.length > 0);
  assert.equal((await paymentsOf(expired)).length, 0);
  assert.equal((await enrolmentRow(expired)).status, "reserved");
});

it("a live reservation keeps the seat it already holds", async () => {
  const viewer = await newUser();
  const classId = await newClass({ capacity: 1 });
  const id = await enrol(classId, "reserved");

  const result = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  assert.equal((await enrolmentRow(id)).status, "confirmed");
});

// ------------------------------------------- 6.6 migration 008 and references

it("the same proof file cannot be recorded twice", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");
  const sent = body(id);

  assert.equal(
    (await recordManualPayment(sent, await version(id), viewer, storedPdf))
      .kind,
    "ok",
  );
  // The retry carries the version it already consumed, so either guard may
  // answer — but only one payment may exist (§9.12 One proof, one payment).
  const retry = await recordManualPayment(
    sent,
    await version(id),
    viewer,
    storedPdf,
  );
  assert.deepEqual(retry, { kind: "already_recorded" });
  assert.equal((await paymentsOf(id)).length, 1);
});

it("one proof cannot be spread across two enrolments", async () => {
  const viewer = await newUser();
  const classId = await newClass({});
  const first = await enrol(classId, "payment_pending");
  const second = await enrol(classId, "payment_pending");
  const sent = body(first);

  assert.equal(
    (await recordManualPayment(sent, await version(first), viewer, storedPdf))
      .kind,
    "ok",
  );
  // design 2: the key is prefixed with the enrolment it was issued for, so
  // this is refused before the index is even reached.
  assert.deepEqual(
    await recordManualPayment(
      { ...sent, enrolmentId: second },
      await version(second),
      viewer,
      storedPdf,
    ),
    { kind: "proof_not_yours" },
  );
  assert.equal((await paymentsOf(second)).length, 0);
});

it("ten students share one invoice reference, each with its own proof", async () => {
  // §9.12 One invoice, several students: ten payments, one reference_no, one
  // deal. Nothing checks the reference for uniqueness.
  const viewer = await newUser();
  const classId = await newClass({ capacity: 20 });
  const reference = "INV-2026-0042";
  const ids: string[] = [];

  for (let i = 0; i < 10; i++) {
    const id = await enrol(classId, "payment_pending");
    ids.push(id);
    const result = await recordManualPayment(
      body(id, { method: "invoice", referenceNo: reference }),
      await version(id),
      viewer,
      storedPdf,
    );
    assert.equal(result.kind, "ok", `student ${i}`);
  }

  const [{ count }] = await db()`
    SELECT count(*)::int FROM payment WHERE reference_no = ${reference}`;
  assert.equal(count, 10);
  for (const id of ids)
    assert.equal((await enrolmentRow(id)).status, "confirmed");
});

it("a Stripe payment with no proof is untouched by the 008 rule", async () => {
  // Two payments with no proof key on one enrolment stay legal — the index is
  // partial (migration 008), and Stripe payments carry no proof.
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "confirmed");
  await db()`
    INSERT INTO payment (enrolment_id, method, status, amount_myr)
    VALUES (${id}, 'stripe_card', 'succeeded', 100),
           (${id}, 'stripe_fpx', 'succeeded', 100)`;

  const result = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  assert.equal((await paymentsOf(id)).length, 3);
});

// --------------------------------------------------- the proof file (§14)

it("a key that holds no object records nothing", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");

  assert.deepEqual(
    await recordManualPayment(
      body(id),
      await version(id),
      viewer,
      storedNothing,
    ),
    { kind: "proof_missing" },
  );
  assert.equal((await paymentsOf(id)).length, 0);
});

it("an over-large proof records nothing and reports both numbers", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");
  const big = new Uint8Array(11 * 1024 * 1024);
  big.set(PDF);

  const result = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    async () => big,
  );
  assert.equal(result.kind, "proof_rejected");
  if (result.kind === "proof_rejected") {
    assert.equal(result.check.reason, "too_large");
    if (result.check.reason === "too_large")
      assert.equal(result.check.bytes, 11 * 1024 * 1024);
  }
  assert.equal((await paymentsOf(id)).length, 0);
});

it("a file that is not an image or a PDF records nothing", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "payment_pending");

  const result = await recordManualPayment(
    body(id),
    await version(id),
    viewer,
    // MZ: a Windows executable named slip.pdf by its uploader.
    async () => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]),
  );
  assert.equal(result.kind, "proof_rejected");
  if (result.kind === "proof_rejected")
    assert.equal(result.check.reason, "unsupported_type");
  assert.equal((await paymentsOf(id)).length, 0);
});

// --------------------------------------------------------------- 6.1 the gate

it("only super_admin and operations record, and a refusal writes nothing", async () => {
  const id = await enrol(await newClass({}), "payment_pending");
  for (const role of [
    "management",
    "marketing",
    "sales",
    "support",
    "part_time",
  ] as const) {
    const viewer: Viewer = await newUser(role);
    assert.deepEqual(
      await recordManualPayment(body(id), await version(id), viewer, storedPdf),
      { kind: "forbidden" },
      role,
    );
    assert.equal((await paymentsOf(id)).length, 0, role);
  }

  for (const role of ["super_admin", "operations"] as const) {
    const fresh = await enrol(await newClass({}), "payment_pending");
    const viewer: Viewer = await newUser(role);
    assert.equal(
      (
        await recordManualPayment(
          body(fresh),
          await version(fresh),
          viewer,
          storedPdf,
        )
      ).kind,
      "ok",
      role,
    );
  }
});

it("an enrolment that does not exist records nothing", async () => {
  const viewer = await newUser();
  const missing = crypto.randomUUID();
  assert.deepEqual(
    await recordManualPayment(body(missing), 1, viewer, storedPdf),
    { kind: "not_found" },
  );
  assert.deepEqual(
    await recordManualPayment(
      { ...body(missing), enrolmentId: "not-an-id" },
      1,
      viewer,
      storedPdf,
    ),
    { kind: "not_found" },
  );
});

// An existing payment on the enrolment must not confuse the save (§9.2 reads
// the same rows).
it("a second, different payment on one enrolment is fine", async () => {
  const viewer = await newUser();
  const id = await enrol(await newClass({}), "confirmed");
  await pay(id, { amount: "1000.00" });

  const result = await recordManualPayment(
    body(id, { amountMyr: "2200.00" }),
    await version(id),
    viewer,
    storedPdf,
  );
  assert.equal(result.kind, "ok");
  assert.equal((await paymentsOf(id)).length, 2);
});
