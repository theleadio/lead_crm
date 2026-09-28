// Integration tests for spec §9.5 Deals board and §12.5 stage moves against
// the seeded dev database. Each test rolls back. Skipped when DATABASE_URL
// isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { moveDealStage } from "../lib/deals/stage-service.ts";
import {
  listCourseOptions,
  listDeals,
  listLostReasons,
} from "../lib/deals/service.ts";
import type { DealListQuery } from "../lib/deals/types.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };

// A fresh course, so filter[course] isolates the deals a test inserts.
async function newCourse(isActive = true): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, is_active)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1, ${isActive})
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
  amount?: string | null;
  owner?: string | null;
  funding?: string | null;
  daysInStage?: number;
  company?: string | null;
  headcount?: number | null;
  hrdc?: {
    ref: string | null;
    approval: string | null;
    deadline: string | null;
  };
};

// Open stages only; won/lost need their timestamps (schema CHECKs).
async function insertDeal(course: string, row: DealRow = {}): Promise<string> {
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, course_id, amount_myr,
                      owner_user_id, funding_type, stage_changed_at, company_id,
                      headcount, hrdc_grant_ref, hrdc_approval_date, hrdc_deadline_date)
    VALUES (${row.pipeline ?? "individual"}, ${row.stage ?? "new"}, ${await anyPerson()},
            ${course}, ${row.amount ?? null}, ${row.owner ?? null}, ${row.funding ?? null},
            now() - make_interval(days => ${row.daysInStage ?? 0}), ${row.company ?? null},
            ${row.headcount ?? null}, ${row.hrdc?.ref ?? null}, ${row.hrdc?.approval ?? null},
            ${row.hrdc?.deadline ?? null})
    RETURNING id`;
  return d.id;
}

const q = (
  course: string,
  extra: Partial<DealListQuery> = {},
): DealListQuery => ({
  pipeline: "individual",
  course,
  page: 1,
  limit: 100,
  ...extra,
});

const totalsOf = (r: Awaited<ReturnType<typeof listDeals>>) =>
  Object.fromEntries(
    r.stageTotals.map((t) => [t.stage, [t.count, t.totalMyr]]),
  );

it("list: stageTotals equal a manual sum; every stage listed in order", async () => {
  const course = await newCourse();
  await insertDeal(course, { amount: "100.10" });
  await insertDeal(course, { amount: "200.25" });
  await insertDeal(course, { amount: null });
  await insertDeal(course, { stage: "qualified", amount: "50" });

  const r = await listDeals(q(course), admin);
  assert.deepEqual(
    r.stageTotals.map((t) => t.stage),
    ["new", "engaged", "qualified", "checkout_sent", "won", "lost"],
  );
  assert.deepEqual(totalsOf(r), {
    new: [3, "300.35"],
    engaged: [0, "0.00"],
    qualified: [1, "50.00"],
    checkout_sent: [0, "0.00"],
    won: [0, "0.00"],
    lost: [0, "0.00"],
  });
  assert.equal(r.data.length, 4);
  assert.equal(r.page.total, 4);
});

it("list: filter[stage] narrows cards but not stageTotals", async () => {
  const course = await newCourse();
  await insertDeal(course, { amount: "10" });
  await insertDeal(course, { stage: "qualified", amount: "20" });

  const all = await listDeals(q(course), admin);
  const one = await listDeals(q(course, { stage: "qualified" }), admin);
  assert.deepEqual(one.stageTotals, all.stageTotals);
  assert.deepEqual(
    one.data.map((d) => d.stage),
    ["qualified"],
  );
  assert.equal(one.page.total, 1);
});

it("list: owner, mine, funding and pipeline narrow cards and totals together", async () => {
  const course = await newCourse();
  await insertDeal(course, { amount: "10", owner: sales.id, funding: "hrdc" });
  await insertDeal(course, { amount: "20", owner: SEED_USERS.daphne });
  await insertDeal(course, { amount: "40" });
  await insertDeal(course, { pipeline: "corporate", amount: "80" });

  for (const extra of [
    { owner: sales.id },
    { mine: true },
    { funding: "hrdc" as const },
  ]) {
    const r = await listDeals(q(course, extra), sales);
    assert.equal(r.data.length, 1, JSON.stringify(extra));
    assert.deepEqual(totalsOf(r).new, [1, "10.00"]);
  }
  // A deal with no owner is not "mine" (proposal open question 6).
  const mineAsAdmin = await listDeals(q(course, { mine: true }), admin);
  assert.equal(mineAsAdmin.data.length, 0);

  const corporate = await listDeals(
    q(course, { pipeline: "corporate" }),
    admin,
  );
  assert.deepEqual(totalsOf(corporate).new, [1, "80.00"]);
  assert.equal(corporate.stageTotals[1].stage, "discovery");
});

it("list: created date range uses Kuala Lumpur days, inclusive", async () => {
  const course = await newCourse();
  const id = await insertDeal(course, { amount: "5" });
  // 23:30 KL on 1 Sep = 15:30 UTC.
  await db()`UPDATE deal SET created_at = '2026-09-01T15:30:00Z' WHERE id = ${id}`;
  const count = async (extra: Partial<DealListQuery>) =>
    (await listDeals(q(course, extra), admin)).data.length;
  assert.equal(
    await count({ createdFrom: "2026-09-01", createdTo: "2026-09-01" }),
    1,
  );
  assert.equal(await count({ createdFrom: "2026-09-02" }), 0);
  assert.equal(await count({ createdTo: "2026-08-31" }), 0);
});

it("list: deleted deals excluded; oldest in stage first, ties by id", async () => {
  const course = await newCourse();
  const fresh = await insertDeal(course, { daysInStage: 1 });
  const old = await insertDeal(course, { daysInStage: 20 });
  const gone = await insertDeal(course, { daysInStage: 30, amount: "99" });
  await db()`UPDATE deal SET deleted_at = now() WHERE id = ${gone}`;

  const r = await listDeals(q(course), admin);
  assert.deepEqual(
    r.data.map((d) => d.id),
    [old, fresh],
  );
  assert.deepEqual(totalsOf(r).new, [2, "0.00"]);
  const card = r.data[0];
  assert.equal(card.course?.name, "Test course");
  assert.equal(card.owner, null);
  assert.match(card.version, /^\d{4}-\d{2}-\d{2} /);
});

it("options: inactive lost reasons and courses are excluded", async () => {
  const code = (n: string) => `t_${n}_${crypto.randomUUID()}`;
  const [b, a, off] = [code("b"), code("a"), code("off")];
  await db()`
    INSERT INTO lost_reason (code, label_en, sort_order, is_active) VALUES
      (${b}, 'B', 100001, true), (${a}, 'A', 100000, true), (${off}, 'Off', 99999, false)`;
  const codes = (await listLostReasons()).map((r) => r.code);
  assert.ok(codes.indexOf(a) >= 0 && codes.indexOf(a) < codes.indexOf(b));
  assert.ok(!codes.includes(off));

  const active = await newCourse(true);
  const inactive = await newCourse(false);
  const courses = await listCourseOptions();
  assert.ok(courses.some((c) => c.id === active));
  assert.ok(!courses.some((c) => c.id === inactive));
});

// ---------------------------------------------------------------------------
// Stage moves — spec §12.5, §12.6, §11.1 DealStageChanged.
// ---------------------------------------------------------------------------

const management: Viewer = { id: SEED_USERS.daphne, role: "management" };
const partTimer: Viewer = { id: SEED_USERS.leeYee, role: "part_time" };

async function newReason(isActive = true): Promise<string> {
  const [r] = await db()`
    INSERT INTO lost_reason (code, label_en, is_active)
    VALUES (${`t_${crypto.randomUUID()}`}, 'Test reason', ${isActive}) RETURNING id`;
  return r.id;
}

async function anyCompany(): Promise<string> {
  const [c] =
    await db()`SELECT id FROM company WHERE deleted_at IS NULL LIMIT 1`;
  return c.id;
}

async function dealRow(id: string) {
  const [d] = await db()`
    SELECT stage, won_at, lost_at, lost_reason_id,
           stage_changed_at = now() AS changed_now FROM deal WHERE id = ${id}`;
  return { ...d };
}

async function counts(id: string) {
  const [c] = await db()`
    SELECT (SELECT count(*)::int FROM deal_stage_history WHERE deal_id = ${id}) AS history,
           (SELECT count(*)::int FROM event_outbox WHERE aggregate_id = ${id}) AS outbox,
           (SELECT count(*)::int FROM audit_log WHERE entity = 'deal' AND entity_id = ${id}) AS audit`;
  return { ...c };
}

it("move: writes history, outbox payload and audit; server sets won_at", async () => {
  const id = await insertDeal(await newCourse(), { daysInStage: 5 });
  const r = await moveDealStage(id, { toStage: "won" }, admin);
  assert.ok(
    r.kind === "ok" && r.deal.stage === "won" && r.deal.lostReason === null,
  );

  const d = await dealRow(id);
  assert.ok(d.won_at && d.changed_now);
  assert.equal(d.lost_at, null);
  const [h] = await db()`
    SELECT from_stage, to_stage, changed_by FROM deal_stage_history WHERE deal_id = ${id}`;
  assert.deepEqual(
    { ...h },
    { from_stage: "new", to_stage: "won", changed_by: admin.id },
  );
  const [e] = await db()`
    SELECT type, aggregate_type, payload FROM event_outbox WHERE aggregate_id = ${id}`;
  assert.deepEqual(
    { ...e },
    {
      type: "DealStageChanged",
      aggregate_type: "deal",
      payload: {
        dealId: id,
        fromStage: "new",
        toStage: "won",
        byUserId: admin.id,
      },
    },
  );
  assert.equal((await counts(id)).audit, 1);
});

it("move: lost stores reason and lost_at; reopen clears both", async () => {
  const id = await insertDeal(await newCourse(), { stage: "qualified" });
  const reason = await newReason();
  const lost = await moveDealStage(
    id,
    { toStage: "lost", lostReasonId: reason },
    sales,
  );
  assert.ok(lost.kind === "ok");
  assert.equal(lost.deal.lostReason?.id, reason);
  assert.equal(lost.deal.lostReason?.labelEn, "Test reason");
  let d = await dealRow(id);
  assert.ok(d.lost_at && d.lost_reason_id === reason);

  const reopened = await moveDealStage(id, { toStage: "qualified" }, sales);
  assert.ok(reopened.kind === "ok" && reopened.deal.lostReason === null);
  d = await dealRow(id);
  assert.equal(d.lost_at, null);
  assert.equal(d.lost_reason_id, null);
  assert.ok(d.changed_now);
  const history = await db()`
    SELECT from_stage, to_stage FROM deal_stage_history WHERE deal_id = ${id}`;
  assert.deepEqual(history.map((h) => `${h.from_stage}>${h.to_stage}`).sort(), [
    "lost>qualified",
    "qualified>lost",
  ]);
});

it("move: lostReasonId on a non-lost move is ignored", async () => {
  const id = await insertDeal(await newCourse());
  const r = await moveDealStage(
    id,
    { toStage: "engaged", lostReasonId: await newReason() },
    admin,
  );
  assert.equal(r.kind, "ok");
  assert.equal((await dealRow(id)).lost_reason_id, null);
});

it("move: same stage is ok with no history, event or audit", async () => {
  const id = await insertDeal(await newCourse(), { stage: "engaged" });
  const before = await counts(id);
  const r = await moveDealStage(id, { toStage: "engaged" }, admin);
  assert.ok(r.kind === "ok" && r.deal.stage === "engaged");
  assert.deepEqual(await counts(id), before);
});

it("move: every 422 leaves the deal, history and outbox unchanged", async () => {
  const course = await newCourse();
  const company = await anyCompany();
  const individual = await insertDeal(course, { stage: "qualified" });
  const corporate = await insertDeal(course, {
    pipeline: "corporate",
    stage: "discovery",
    company,
    funding: "company",
  });
  const hrdc = await insertDeal(course, {
    pipeline: "corporate",
    stage: "funding",
    company,
    headcount: 5,
    funding: "hrdc",
    hrdc: { ref: null, approval: "2026-10-01", deadline: "2026-11-01" },
  });
  const cases: [string, string, string | undefined, string, string[]?][] = [
    [individual, "discovery", undefined, "invalid_stage"],
    [individual, "archived", undefined, "invalid_stage"],
    [individual, "lost", undefined, "lost_reason_required"],
    [individual, "lost", await newReason(false), "lost_reason_required"],
    [individual, "lost", crypto.randomUUID(), "lost_reason_required"],
    [
      corporate,
      "proposal_sent",
      undefined,
      "corporate_fields_missing",
      ["headcount"],
    ],
    [hrdc, "won", undefined, "hrdc_fields_missing", ["hrdcGrantRef"]],
  ];
  for (const [id, toStage, lostReasonId, code, missing] of cases) {
    const before = { deal: await dealRow(id), counts: await counts(id) };
    const r = await moveDealStage(id, { toStage, lostReasonId }, admin);
    assert.deepEqual(r, { kind: "rule", code, missing }, `${toStage} ${code}`);
    assert.deepEqual(
      { deal: await dealRow(id), counts: await counts(id) },
      before,
    );
  }
});

it("move: a failed history insert rolls back the deal and the outbox", async () => {
  const id = await insertDeal(await newCourse());
  const sql = db();
  // forbid_change() raises on any row it fires for (migration 001).
  await sql`CREATE TRIGGER deals_test_fail BEFORE INSERT ON deal_stage_history
            FOR EACH ROW EXECUTE FUNCTION forbid_change()`;
  await sql`SAVEPOINT move`;
  await assert.rejects(moveDealStage(id, { toStage: "engaged" }, admin));
  await sql`ROLLBACK TO SAVEPOINT move`;
  assert.equal((await dealRow(id)).stage, "new");
  assert.deepEqual(await counts(id), { history: 0, outbox: 0, audit: 0 });
});

it("move: management and part_time are refused; unknown or deleted deal is 404", async () => {
  const id = await insertDeal(await newCourse());
  for (const viewer of [management, partTimer])
    assert.deepEqual(await moveDealStage(id, { toStage: "engaged" }, viewer), {
      kind: "forbidden",
    });
  assert.equal((await dealRow(id)).stage, "new");
  assert.deepEqual(await counts(id), { history: 0, outbox: 0, audit: 0 });

  const nf = { kind: "not_found" };
  assert.deepEqual(await moveDealStage("nope", { toStage: "won" }, admin), nf);
  assert.deepEqual(
    await moveDealStage(crypto.randomUUID(), { toStage: "won" }, admin),
    nf,
  );
  await db()`UPDATE deal SET deleted_at = now() WHERE id = ${id}`;
  assert.deepEqual(await moveDealStage(id, { toStage: "engaged" }, admin), nf);
});

it("move: HRDC deal entering funding raises one hrdc_deadline task", async () => {
  const course = await newCourse();
  const base = {
    pipeline: "corporate" as const,
    stage: "proposal_sent",
    company: await anyCompany(),
    headcount: 5,
    funding: "hrdc",
    owner: sales.id,
  };
  const withDate = await insertDeal(course, {
    ...base,
    hrdc: { ref: null, approval: null, deadline: "2026-11-15" },
  });
  const noDate = await insertDeal(course, base);
  const tasks = (id: string) => db()`
    SELECT assigned_user_id, deal_id,
           (due_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS due
    FROM task WHERE deal_id = ${id} AND type = 'hrdc_deadline' AND done_at IS NULL`;

  for (const to of ["funding", "proposal_sent", "funding"])
    assert.equal(
      (await moveDealStage(withDate, { toStage: to }, sales)).kind,
      "ok",
    );
  const t = await tasks(withDate);
  assert.equal(t.length, 1);
  assert.deepEqual(
    { ...t[0] },
    { assigned_user_id: sales.id, deal_id: withDate, due: "2026-11-15" },
  );

  assert.equal(
    (await moveDealStage(noDate, { toStage: "funding" }, sales)).kind,
    "ok",
  );
  assert.equal((await tasks(noDate)).length, 0);
});
