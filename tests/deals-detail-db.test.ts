// Integration tests for spec §9.6 Deal detail — GET /api/deals/:id and
// PATCH /api/deals/:id (§7), the §12.5 corporate invariant on edit, the
// §12.6 hrdc_deadline task, and §12.9 (editing is not contact activity).
// Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { getDealDetail, updateDeal } from "../lib/deals/detail-service.ts";
import { moveDealStage } from "../lib/deals/stage-service.ts";
import type { DealUpdate } from "../lib/deals/types.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };
const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const partTime: Viewer = { id: SEED_USERS.leeYee, role: "part_time" };
const management: Viewer = { id: SEED_USERS.admin, role: "management" };
const operations: Viewer = { id: SEED_USERS.admin, role: "operations" };
const support: Viewer = { id: SEED_USERS.weiPing, role: "support" };

async function newCourse(): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, is_active)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1, true)
    RETURNING id`;
  return c.id;
}

async function newCompany(): Promise<string> {
  const [c] = await db()`
    INSERT INTO company (legal_name) VALUES (${`Co ${crypto.randomUUID()}`})
    RETURNING id`;
  return c.id;
}

async function anyPerson(): Promise<string> {
  const [p] = await db()`
    SELECT id FROM person WHERE deleted_at IS NULL AND merged_into_id IS NULL LIMIT 1`;
  return p.id;
}

type DealRow = {
  pipeline?: "individual" | "corporate";
  stage?: string;
  company?: string | null;
  headcount?: number | null;
  funding?: string | null;
  amount?: string | null;
  owner?: string | null;
  deadline?: string | null;
  person?: string;
};

// Open stages only; won/lost need their timestamps (001 CHECKs).
async function insertDeal(row: DealRow = {}): Promise<string> {
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, course_id, company_id, headcount,
                      funding_type, amount_myr, owner_user_id, hrdc_deadline_date)
    VALUES (${row.pipeline ?? "individual"}, ${row.stage ?? "new"},
            ${row.person ?? (await anyPerson())}, ${await newCourse()},
            ${row.company ?? null}, ${row.headcount ?? null}, ${row.funding ?? null},
            ${row.amount ?? null}, ${row.owner ?? SEED_USERS.weiPing},
            ${row.deadline ?? null})
    RETURNING id`;
  return d.id;
}

async function version(id: string): Promise<number> {
  const r = await getDealDetail(id, admin);
  assert.equal(r.kind, "ok");
  return r.kind === "ok" ? r.deal.version : 0;
}

// Edit with the deal's current version, unless one is given.
async function edit(
  id: string,
  body: DealUpdate,
  viewer: Viewer = admin,
  ifMatch?: number,
) {
  return updateDeal(id, body, ifMatch ?? (await version(id)), viewer);
}

const openHrdcTask = async (dealId: string) =>
  db()`SELECT id,
              (due_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS due_date
       FROM task
       WHERE deal_id = ${dealId} AND type = 'hrdc_deadline' AND done_at IS NULL`;

// ---------------------------------------------------------------- read (3.4)

it("detail: returns history, tasks, enrolments and the linked enquiry", async () => {
  const course = await newCourse();
  const person = await anyPerson();
  const id = await insertDeal({ stage: "new", person });
  await moveDealStage(id, { toStage: "engaged" }, admin);
  await moveDealStage(id, { toStage: "qualified" }, admin);
  await db()`
    INSERT INTO task (type, title, deal_id, person_id, assigned_user_id)
    VALUES ('follow_up', 'Call them', ${id}, ${person}, ${SEED_USERS.weiPing})`;
  const [cls] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity)
    VALUES (${course}, ${`C-${crypto.randomUUID()}`}, current_date, current_date,
            'en', 'online', 'https://example.test/class', 10)
    RETURNING id`;
  await db()`
    INSERT INTO enrolment (person_id, class_id, deal_id, status, price_paid_myr)
    VALUES (${person}, ${cls.id}, ${id}, 'confirmed', '1200.00')`;
  await db()`
    INSERT INTO enquiry (person_id, channel, status, deal_id, first_message_at)
    VALUES (${person}, 'whatsapp', 'converted', ${id}, now())`;

  const r = await getDealDetail(id, admin);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  // Both real moves are recorded. They share changed_at here — now() is fixed
  // for this transaction — so their relative order is not asserted; in
  // production each move is its own transaction with its own now().
  assert.deepEqual(
    r.deal.stageHistory.map((h) => `${h.fromStage}>${h.toStage}`).sort(),
    ["engaged>qualified", "new>engaged"],
  );
  assert.equal(r.deal.stageHistory[0].changedBy !== null, true);
  assert.equal(r.deal.tasks.length, 1);
  assert.equal(r.deal.enrolments[0].pricePaidMyr, "1200.00");
  assert.equal(r.deal.enquiry?.channel, "whatsapp");
  assert.equal(r.deal.person.id, person);
});

it("detail: stage history is newest first", async () => {
  const id = await insertDeal();
  // Explicit timestamps, so the order is the query's and not a tie-break.
  for (const [from, to, days] of [
    ["new", "engaged", 3],
    ["engaged", "qualified", 1],
  ] as const)
    await db()`
      INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by, changed_at)
      VALUES (${id}, ${from}, ${to}, ${admin.id},
              now() - make_interval(days => ${days}))`;

  const r = await getDealDetail(id, admin);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.deepEqual(
    r.deal.stageHistory.map((h) => `${h.fromStage}>${h.toStage}`),
    ["engaged>qualified", "new>engaged"],
  );
});

it("detail: empty panels are empty arrays and nulls, not missing", async () => {
  const id = await insertDeal();
  const r = await getDealDetail(id, admin);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.deepEqual(r.deal.stageHistory, []);
  assert.deepEqual(r.deal.tasks, []);
  assert.deepEqual(r.deal.enrolments, []);
  assert.equal(r.deal.enquiry, null);
  assert.equal(r.deal.company, null);
  assert.equal(r.deal.class, null);
  assert.equal(r.deal.lostReason, null);
});

it("detail: part_time is refused; unknown, junk and deleted ids are 404", async () => {
  const id = await insertDeal();
  assert.equal((await getDealDetail(id, partTime)).kind, "forbidden");
  assert.equal((await getDealDetail(id, operations)).kind, "ok");
  assert.equal((await getDealDetail(id, marketing)).kind, "ok");
  assert.equal(
    (await getDealDetail("00000000-0000-4000-8000-0000000000ff", admin)).kind,
    "not_found",
  );
  assert.equal((await getDealDetail("not-a-uuid", admin)).kind, "not_found");
  await db()`UPDATE deal SET deleted_at = now() WHERE id = ${id}`;
  assert.equal((await getDealDetail(id, admin)).kind, "not_found");
});

it("detail: version round-trips straight back as If-Match", async () => {
  const id = await insertDeal();
  const v = await version(id);
  assert.equal(Number.isInteger(v), true);
  assert.equal((await edit(id, { amountMyr: "100" }, admin, v)).kind, "ok");
});

// --------------------------------------------------------- permissions (6.1)

it("edit: super_admin, sales and support may edit; read-only roles cannot", async () => {
  const id = await insertDeal();
  assert.equal((await edit(id, { amountMyr: "10" }, admin)).kind, "ok");
  assert.equal((await edit(id, { amountMyr: "20" }, sales)).kind, "ok");
  assert.equal((await edit(id, { amountMyr: "30" }, support)).kind, "ok");

  for (const viewer of [management, marketing, operations, partTime])
    assert.equal(
      (await edit(id, { amountMyr: "999" }, viewer)).kind,
      "forbidden",
      `${viewer.role} must not edit`,
    );
  const [row] = await db()`SELECT amount_myr FROM deal WHERE id = ${id}`;
  assert.equal(row.amount_myr, "30.00");
});

// -------------------------------------------------------- concurrency (6.2)

it("edit: two saves from the same version — the second is refused", async () => {
  const id = await insertDeal({ amount: "100" });
  const loaded = await version(id);

  // Both tabs hold `loaded`. The first save wins and bumps the version.
  // This is a real two-save test now: the 005 trigger bumps on every UPDATE,
  // where updated_at = now() could not move inside one transaction.
  assert.equal(
    (await edit(id, { amountMyr: "200" }, admin, loaded)).kind,
    "ok",
  );
  assert.equal(await version(id), loaded + 1);

  // The second, still holding the old version, writes nothing.
  const second = await edit(id, { amountMyr: "300" }, admin, loaded);
  assert.equal(second.kind, "stale");
  const [row] = await db()`SELECT amount_myr FROM deal WHERE id = ${id}`;
  assert.equal(row.amount_myr, "200.00");
});

it("edit: the version goes up by exactly one per save", async () => {
  const id = await insertDeal();
  const start = await version(id);
  for (let i = 1; i <= 3; i++) {
    const r = await edit(id, { amountMyr: String(100 * i) });
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.deal.version, start + i);
  }
});

it("edit: a fresh version comes back, so a second save needs no reload", async () => {
  const id = await insertDeal();
  const first = await edit(id, { amountMyr: "100" });
  assert.equal(first.kind, "ok");
  if (first.kind !== "ok") return;
  const next = await updateDeal(
    id,
    { amountMyr: "150" },
    first.deal.version,
    admin,
  );
  assert.equal(next.kind, "ok");
});

it("edit: an unknown or deleted deal is not_found", async () => {
  const id = await insertDeal();
  const v = await version(id);
  await db()`UPDATE deal SET deleted_at = now() WHERE id = ${id}`;
  assert.equal(
    (await edit(id, { amountMyr: "1" }, admin, v)).kind,
    "not_found",
  );
  assert.equal(
    (await updateDeal("not-a-uuid", { amountMyr: "1" }, v, admin)).kind,
    "not_found",
  );
});

it("edit: a reference that names no live record is invalid, not a FK error", async () => {
  const id = await insertDeal();
  const missing = "00000000-0000-4000-8000-0000000000fe";
  const r = await edit(id, { companyId: missing });
  assert.equal(r.kind, "invalid");
  if (r.kind === "invalid") assert.ok(r.fields.companyId);
  assert.equal((await edit(id, { ownerId: missing })).kind, "invalid");
  assert.equal((await edit(id, { courseId: missing })).kind, "invalid");
});

// -------------------------------------------------- corporate invariant (6.3)

it("edit: clearing a corporate field past discovery is 422 and writes nothing", async () => {
  const company = await newCompany();
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company,
    headcount: 12,
    funding: "company",
  });
  const r = await edit(id, { companyId: null });
  assert.equal(r.kind, "corporate_fields_missing");
  if (r.kind === "corporate_fields_missing")
    assert.deepEqual(r.missing, ["companyId"]);

  const [row] = await db()`SELECT company_id FROM deal WHERE id = ${id}`;
  assert.equal(row.company_id, company);

  // Headcount and funding type are gated the same way.
  assert.equal(
    (await edit(id, { headcount: null })).kind,
    "corporate_fields_missing",
  );
  assert.equal(
    (await edit(id, { fundingType: null })).kind,
    "corporate_fields_missing",
  );
});

it("edit: the same edit during discovery is allowed", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "discovery",
    company: await newCompany(),
    headcount: 5,
    funding: "company",
  });
  assert.equal((await edit(id, { companyId: null })).kind, "ok");
  const [row] = await db()`SELECT company_id FROM deal WHERE id = ${id}`;
  assert.equal(row.company_id, null);
});

// ------------------------------------------------------- HRDC task (6.4)

it("edit: a deadline date on an HRDC deal in funding raises one task", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
  });
  assert.equal((await openHrdcTask(id)).length, 0);

  assert.equal((await edit(id, { hrdcDeadlineDate: "2026-11-30" })).kind, "ok");
  const tasks = await openHrdcTask(id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].due_date, "2026-11-30");
  const [t] =
    await db()`SELECT assigned_user_id FROM task WHERE id = ${tasks[0].id}`;
  assert.equal(t.assigned_user_id, SEED_USERS.weiPing);
});

it("edit: changing the deadline re-dates the one open task", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
    deadline: "2026-11-30",
  });
  await moveDealStage(id, { toStage: "proposal_sent" }, admin);
  await moveDealStage(id, { toStage: "funding" }, admin);
  assert.equal((await openHrdcTask(id)).length, 1);

  assert.equal((await edit(id, { hrdcDeadlineDate: "2026-12-15" })).kind, "ok");
  const tasks = await openHrdcTask(id);
  assert.equal(tasks.length, 1, "migration 004: one open task per deal");
  assert.equal(tasks[0].due_date, "2026-12-15");
});

it("edit: setting the same deadline again writes nothing", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
  });
  await edit(id, { hrdcDeadlineDate: "2026-11-30" });
  const [before] = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE entity = 'task'`;

  assert.equal((await edit(id, { hrdcDeadlineDate: "2026-11-30" })).kind, "ok");
  const [after] = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE entity = 'task'`;
  assert.equal(after.n, before.n);
  assert.equal((await openHrdcTask(id)).length, 1);
});

it("edit: clearing the deadline closes the open task", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
  });
  await edit(id, { hrdcDeadlineDate: "2026-11-30" });
  const [open] = await openHrdcTask(id);

  assert.equal((await edit(id, { hrdcDeadlineDate: null })).kind, "ok");
  assert.equal((await openHrdcTask(id)).length, 0);
  const [closed] =
    await db()`SELECT done_at, done_by FROM task WHERE id = ${open.id}`;
  assert.notEqual(closed.done_at, null);
  assert.equal(closed.done_by, admin.id);
});

it("edit: funding type off hrdc clears the fields and closes the task", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
  });
  await edit(id, {
    hrdcDeadlineDate: "2026-11-30",
    hrdcGrantRef: "HRDC-1",
    hrdcApprovalDate: "2026-10-01",
  });
  assert.equal((await openHrdcTask(id)).length, 1);

  assert.equal((await edit(id, { fundingType: "company" })).kind, "ok");
  const [row] = await db()`
    SELECT hrdc_grant_ref, hrdc_approval_date, hrdc_deadline_date
    FROM deal WHERE id = ${id}`;
  assert.deepEqual(
    [row.hrdc_grant_ref, row.hrdc_approval_date, row.hrdc_deadline_date],
    [null, null, null],
  );
  assert.equal((await openHrdcTask(id)).length, 0);
});

it("edit: a deadline before funding stores the date and raises no task", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "discovery",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
  });
  assert.equal((await edit(id, { hrdcDeadlineDate: "2026-11-30" })).kind, "ok");
  const [row] = await db()`
    SELECT hrdc_deadline_date::text AS d FROM deal WHERE id = ${id}`;
  assert.equal(row.d, "2026-11-30");
  assert.equal((await openHrdcTask(id)).length, 0);
});

it("edit: reassigning the owner leaves an open task where it was", async () => {
  const id = await insertDeal({
    pipeline: "corporate",
    stage: "funding",
    company: await newCompany(),
    headcount: 8,
    funding: "hrdc",
    owner: SEED_USERS.weiPing,
  });
  await edit(id, { hrdcDeadlineDate: "2026-11-30" });
  assert.equal((await edit(id, { ownerId: SEED_USERS.admin })).kind, "ok");
  const [t] = await db()`
    SELECT assigned_user_id FROM task
    WHERE deal_id = ${id} AND type = 'hrdc_deadline' AND done_at IS NULL`;
  assert.equal(t.assigned_user_id, SEED_USERS.weiPing);
});

// ------------------------------------------------------ lost reason (6.5)

async function lostDeal(): Promise<{ id: string; reasons: string[] }> {
  const id = await insertDeal({ stage: "qualified" });
  const reasons = await db()`
    SELECT id FROM lost_reason WHERE is_active ORDER BY sort_order LIMIT 2`;
  await moveDealStage(
    id,
    { toStage: "lost", lostReasonId: reasons[0].id },
    admin,
  );
  return { id, reasons: reasons.map((r) => r.id) };
}

it("edit: a lost reason can be swapped for another active one", async () => {
  const { id, reasons } = await lostDeal();
  const [before] = await db()`
    SELECT lost_at, stage_changed_at,
           (SELECT count(*)::int FROM deal_stage_history WHERE deal_id = ${id}) AS hist,
           (SELECT count(*)::int FROM event_outbox WHERE aggregate_id = ${id}) AS events
    FROM deal WHERE id = ${id}`;

  assert.equal((await edit(id, { lostReasonId: reasons[1] })).kind, "ok");
  const [after] = await db()`
    SELECT lost_reason_id, lost_at, stage_changed_at,
           (SELECT count(*)::int FROM deal_stage_history WHERE deal_id = ${id}) AS hist,
           (SELECT count(*)::int FROM event_outbox WHERE aggregate_id = ${id}) AS events
    FROM deal WHERE id = ${id}`;
  assert.equal(after.lost_reason_id, reasons[1]);
  // A correction, not a move.
  assert.equal(+after.lost_at, +before.lost_at);
  assert.equal(+after.stage_changed_at, +before.stage_changed_at);
  assert.equal(after.hist, before.hist);
  assert.equal(after.events, before.events);
});

it("edit: clearing it, a dead reason, or a non-lost deal are all refused", async () => {
  const { id, reasons } = await lostDeal();
  assert.equal(
    (await edit(id, { lostReasonId: null })).kind,
    "lost_reason_required",
  );

  const [dead] = await db()`
    INSERT INTO lost_reason (code, label_en, is_active, sort_order)
    VALUES (${`dead-${crypto.randomUUID()}`}, 'Retired', false, 99) RETURNING id`;
  assert.equal(
    (await edit(id, { lostReasonId: dead.id })).kind,
    "lost_reason_required",
  );
  const [row] = await db()`SELECT lost_reason_id FROM deal WHERE id = ${id}`;
  assert.equal(row.lost_reason_id, reasons[0]);

  const open = await insertDeal({ stage: "qualified" });
  assert.equal(
    (await edit(open, { lostReasonId: reasons[0] })).kind,
    "lost_reason_required",
  );
});

// ------------------------------------------------ audit and activity (6.6)

it("edit: one audit row holds only the fields that changed", async () => {
  const id = await insertDeal({ amount: "100", owner: SEED_USERS.weiPing });
  const before = await db()`
    SELECT count(*)::int AS n FROM audit_log WHERE entity = 'deal' AND entity_id = ${id}`;

  assert.equal(
    (await edit(id, { amountMyr: "500.00", ownerId: SEED_USERS.admin })).kind,
    "ok",
  );
  const rows = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'deal' AND entity_id = ${id} ORDER BY created_at DESC`;
  assert.equal(rows.length, before[0].n + 1);
  assert.deepEqual(Object.keys(rows[0].after).sort(), [
    "amount_myr",
    "owner_user_id",
  ]);
  assert.equal(rows[0].before.amount_myr, "100.00");
});

it("edit: editing a field is not contact activity (§12.9)", async () => {
  const person = await anyPerson();
  const id = await insertDeal({ person });
  await db()`UPDATE person SET last_activity_at = NULL WHERE id = ${person}`;

  assert.equal((await edit(id, { amountMyr: "42" })).kind, "ok");
  const [p] =
    await db()`SELECT last_activity_at FROM person WHERE id = ${person}`;
  assert.equal(p.last_activity_at, null);
});
