// Integration tests for the §11.1 outbox drain: SKIP LOCKED claim, retry cap,
// savepoint per handler. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import postgres from "postgres";
import assert from "node:assert/strict";
import { drainOutbox } from "../lib/events/drain.ts";
import type { EventHandler } from "../lib/events/handlers.ts";
import { moveDealStage } from "../lib/deals/stage-service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const skip = !process.env.DATABASE_URL && "no DATABASE_URL";
const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip }, () => rollbackAfter(fn));

// n pending rows, oldest first; created_at is spaced so ordering is exact.
async function insertEvents(
  n: number,
  type = "ClassPublished",
  attempts = 0,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [r] = await db()`
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, attempts, created_at)
      VALUES (${type}, 'class', ${crypto.randomUUID()}, '{}', ${attempts},
              now() - make_interval(secs => ${n - i}))
      RETURNING id`;
    ids.push(r.id);
  }
  return ids;
}

const row = async (id: string) =>
  (
    await db()`SELECT processed_at, attempts, last_error FROM event_outbox WHERE id = ${id}`
  )[0];

// Park every other pending row so counts only see ours (rolled back).
const parkOthers = () =>
  db()`UPDATE event_outbox SET processed_at = now() WHERE processed_at IS NULL`;

it("drain: processes pending rows, sets processed_at and attempts=1", async () => {
  await parkOthers();
  const ids = await insertEvents(2);
  const seen: string[] = [];
  const handler: EventHandler = async (e) => {
    seen.push(e.id);
  };
  const r = await drainOutbox({ handlers: { ClassPublished: handler } });
  assert.deepEqual(r, { claimed: 2, processed: 2, failed: 0 });
  assert.deepEqual(seen, ids);
  for (const id of ids) {
    const x = await row(id);
    assert.notEqual(x.processed_at, null);
    assert.equal(x.attempts, 1);
    assert.equal(x.last_error, null);
  }
});

it("drain: a throwing handler leaves its row pending with last_error and attempts=1, rows behind it still processed", async () => {
  await parkOthers();
  const ids = await insertEvents(3);
  const r = await drainOutbox({
    handlers: {
      ClassPublished: async (e) => {
        if (e.id === ids[0]) throw new Error("boom");
      },
    },
  });
  assert.deepEqual(r, { claimed: 3, processed: 2, failed: 1 });
  const a = await row(ids[0]);
  assert.equal(a.processed_at, null);
  assert.equal(a.attempts, 1);
  assert.equal(a.last_error, "boom");
  assert.notEqual((await row(ids[1])).processed_at, null);
  assert.notEqual((await row(ids[2])).processed_at, null);
});

it("drain: a failing handler's partial writes are rolled back", async () => {
  await parkOthers();
  await insertEvents(1);
  const name = `drain-${crypto.randomUUID()}`;
  const r = await drainOutbox({
    handlers: {
      ClassPublished: async () => {
        await db()`INSERT INTO tag (name) VALUES (${name})`;
        throw new Error("after write");
      },
    },
  });
  assert.equal(r.failed, 1);
  const tags = await db()`SELECT 1 FROM tag WHERE name = ${name}`;
  assert.equal(tags.length, 0);
});

it("drain: a type with no handler is marked processed", async () => {
  await parkOthers();
  const [id] = await insertEvents(1);
  const r = await drainOutbox({ handlers: {} });
  assert.deepEqual(r, { claimed: 1, processed: 1, failed: 0 });
  assert.notEqual((await row(id)).processed_at, null);
});

it("drain: empty queue and batch larger than queue return zeros / no error", async () => {
  await parkOthers();
  assert.deepEqual(await drainOutbox({ handlers: {} }), {
    claimed: 0,
    processed: 0,
    failed: 0,
  });
  await insertEvents(2);
  const r = await drainOutbox({ batch: 100, handlers: {} });
  assert.equal(r.claimed, 2);
});

it("drain: rows with attempts >= 5 are not claimed", async () => {
  await parkOthers();
  const [id] = await insertEvents(1, "ClassPublished", 5);
  const r = await drainOutbox({ handlers: {} });
  assert.equal(r.claimed, 0);
  assert.equal((await row(id)).processed_at, null);
});

it("drain: batch limits claims", async () => {
  await parkOthers();
  const ids = await insertEvents(5);
  const r = await drainOutbox({ batch: 2, handlers: {} });
  assert.equal(r.claimed, 2);
  assert.notEqual((await row(ids[0])).processed_at, null);
  assert.notEqual((await row(ids[1])).processed_at, null);
  assert.equal((await row(ids[2])).processed_at, null);
});

// Rows are back-dated ~10 years so they are the oldest pending rows and fill
// both batches exactly, whatever else is in the database.
test(
  "drain: two concurrent drains never process the same row",
  { skip },
  async () => {
    const ids: string[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const [r] = await db()`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_at)
        VALUES ('ClassPublished', 'class', ${crypto.randomUUID()}, '{}',
                now() - interval '10 years' - make_interval(secs => ${20 - i}))
        RETURNING id`;
        ids.push(r.id);
      }
      const mine = new Set(ids);
      const seen: string[] = [];
      const handlers = {
        ClassPublished: async (e: { id: string }) => {
          await new Promise((r) => setTimeout(r, 20));
          if (mine.has(e.id)) seen.push(e.id);
        },
      };
      await Promise.all([
        drainOutbox({ batch: 10, handlers }),
        drainOutbox({ batch: 10, handlers }),
      ]);
      assert.equal(seen.length, 20);
      assert.equal(new Set(seen).size, 20);
    } finally {
      await db()`DELETE FROM event_outbox WHERE id = ANY(${ids}::uuid[])`;
    }
  },
);

// Deterministic SKIP LOCKED proof: a row locked by another connection must be
// skipped (plain FOR UPDATE would block until the lock is released).
test(
  "drain: skips a row locked by another connection instead of waiting",
  { skip },
  async () => {
    const ids: string[] = [];
    const other = postgres(process.env.DATABASE_URL!, { max: 1 });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    let holder: Promise<unknown> | undefined;
    try {
      for (let i = 0; i < 3; i++) {
        const [r] = await db()`
          INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_at)
          VALUES ('ClassPublished', 'class', ${crypto.randomUUID()}, '{}',
                  now() - interval '10 years' - make_interval(secs => ${3 - i}))
          RETURNING id`;
        ids.push(r.id);
      }
      const [lockedId, ...rest] = ids;
      holder = other.begin(async (tx) => {
        await tx`SELECT id FROM event_outbox WHERE id = ${lockedId} FOR UPDATE`;
        locked();
        await held;
      });
      await lockTaken;

      const seen: string[] = [];
      const handlers = {
        ClassPublished: async (e: { id: string }) => {
          seen.push(e.id);
        },
      };
      let timer: NodeJS.Timeout | undefined;
      const r = await Promise.race([
        drainOutbox({ batch: 3, handlers }),
        new Promise<never>((_, rej) => {
          timer = setTimeout(
            () => rej(new Error("drain blocked on a locked row")),
            3000,
          );
        }),
      ]).finally(() => clearTimeout(timer));

      assert.equal(r.claimed, 2);
      assert.deepEqual(seen, rest);
      assert.equal((await row(lockedId)).processed_at, null);
      assert.equal((await row(lockedId)).attempts, 0);
      for (const id of rest)
        assert.notEqual((await row(id)).processed_at, null);
    } finally {
      release();
      await holder?.catch(() => {});
      await other.end();
      await db()`DELETE FROM event_outbox WHERE id = ANY(${ids}::uuid[])`;
    }
  },
);

it("drain: processes a real DealStageChanged row from a real stage move", async () => {
  await parkOthers();
  const [course] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1) RETURNING id`;
  const [person] = await db()`
    SELECT id FROM person WHERE deleted_at IS NULL AND merged_into_id IS NULL LIMIT 1`;
  const [deal] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, course_id)
    VALUES ('individual', 'new', ${person.id}, ${course.id}) RETURNING id`;
  const admin = { id: SEED_USERS.admin, role: "super_admin" } as const;
  const res = await moveDealStage(deal.id, { toStage: "engaged" }, admin);
  assert.equal(res.kind, "ok");
  const got: unknown[] = [];
  await drainOutbox({
    handlers: {
      DealStageChanged: async (e) => {
        got.push(e.payload);
      },
    },
  });
  assert.deepEqual(got, [
    {
      dealId: deal.id,
      fromStage: "new",
      toStage: "engaged",
      byUserId: SEED_USERS.admin,
    },
  ]);
});
