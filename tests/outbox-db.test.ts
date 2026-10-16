// Integration tests for the §11.1 outbox drain: SKIP LOCKED claim, backoff,
// dead letters, stable order, savepoint per handler. Skipped when DATABASE_URL
// isn't set.
import { after, test } from "node:test";
import postgres from "postgres";
import assert from "node:assert/strict";
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  drainOutbox,
  retryDeadEvents,
} from "../lib/events/drain.ts";
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
    await db()`SELECT processed_at, attempts, last_error, dead_at FROM event_outbox WHERE id = ${id}`
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
  assert.deepEqual(r, { claimed: 2, processed: 2, failed: 0, dead: 0 });
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
  assert.deepEqual(r, { claimed: 3, processed: 2, failed: 1, dead: 0 });
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
  assert.deepEqual(r, { claimed: 1, processed: 1, failed: 0, dead: 0 });
  assert.notEqual((await row(id)).processed_at, null);
});

it("drain: empty queue and batch larger than queue return zeros / no error", async () => {
  await parkOthers();
  assert.deepEqual(await drainOutbox({ handlers: {} }), {
    claimed: 0,
    processed: 0,
    failed: 0,
    dead: 0,
  });
  await insertEvents(2);
  const r = await drainOutbox({ batch: 100, handlers: {} });
  assert.equal(r.claimed, 2);
});

it("drain: a dead row is never claimed", async () => {
  await parkOthers();
  const [id] = await insertEvents(1, "ClassPublished", MAX_ATTEMPTS);
  await db()`UPDATE event_outbox SET dead_at = now() WHERE id = ${id}`;
  const r = await drainOutbox({ handlers: {} });
  assert.equal(r.claimed, 0);
  assert.equal((await row(id)).processed_at, null);
});

it("drain: a failing handler schedules the retry in the future; an immediate second drain claims nothing", async () => {
  await parkOthers();
  const [id] = await insertEvents(1);
  const handlers = {
    ClassPublished: async () => {
      throw new Error("down");
    },
  };
  const first = await drainOutbox({ handlers });
  assert.deepEqual(first, { claimed: 1, processed: 0, failed: 1, dead: 0 });
  // now() is fixed inside the test transaction, so the gap is exact.
  const [t] = await db()`
    SELECT next_attempt_at = now() + make_interval(secs => ${BACKOFF_SECONDS[0]}) AS ok
    FROM event_outbox WHERE id = ${id}`;
  assert.equal(t.ok, true);
  assert.equal((await row(id)).dead_at, null);
  assert.deepEqual(await drainOutbox({ handlers }), {
    claimed: 0,
    processed: 0,
    failed: 0,
    dead: 0,
  });
  assert.equal((await row(id)).attempts, 1);
});

it("drain: backoff grows with each failure, and the row is not dead before the cap", async () => {
  await parkOthers();
  for (let before = 1; before < MAX_ATTEMPTS - 1; before++) {
    const [id] = await insertEvents(1, "ClassPublished", before);
    const r = await drainOutbox({
      handlers: {
        ClassPublished: async () => {
          throw new Error("down");
        },
      },
    });
    assert.deepEqual(r, { claimed: 1, processed: 0, failed: 1, dead: 0 });
    const [t] = await db()`
      SELECT next_attempt_at = now() + make_interval(secs => ${BACKOFF_SECONDS[before]}) AS ok
      FROM event_outbox WHERE id = ${id}`;
    assert.equal(t.ok, true, `failure ${before + 1}`);
    assert.equal((await row(id)).dead_at, null);
    await db()`UPDATE event_outbox SET processed_at = now() WHERE id = ${id}`;
  }
});

it("drain: the failure that reaches MAX_ATTEMPTS sets dead_at, keeps last_error and reports dead", async () => {
  await parkOthers();
  const [id] = await insertEvents(1, "ClassPublished", MAX_ATTEMPTS - 1);
  const r = await drainOutbox({
    handlers: {
      ClassPublished: async () => {
        throw new Error("final straw");
      },
    },
  });
  assert.deepEqual(r, { claimed: 1, processed: 0, failed: 1, dead: 1 });
  const x = await row(id);
  assert.equal(x.attempts, MAX_ATTEMPTS);
  assert.notEqual(x.dead_at, null);
  assert.equal(x.last_error, "final straw");
  assert.equal(x.processed_at, null);
  assert.equal((await drainOutbox({ handlers: {} })).claimed, 0);
});

it("drain: a row whose next_attempt_at is in the future is skipped while a due row is claimed", async () => {
  await parkOthers();
  const [later, due] = await insertEvents(2);
  await db()`
    UPDATE event_outbox SET next_attempt_at = now() + interval '1 hour'
    WHERE id = ${later}`;
  const seen: string[] = [];
  const r = await drainOutbox({
    handlers: {
      ClassPublished: async (e) => {
        seen.push(e.id);
      },
    },
  });
  assert.equal(r.claimed, 1);
  assert.deepEqual(seen, [due]);
  assert.equal((await row(later)).processed_at, null);
  assert.equal((await row(later)).attempts, 0);
});

// Everything in this test transaction shares one created_at and one
// next_attempt_at, so seq is the only thing that orders the rows. The oldest
// row (lowest seq) is then UPDATEd, which writes a new tuple version at the
// end of the heap: physical order is B, C, A while seq order is A, B, C. A
// sequential scan is forced so heap order is what a missing seq tiebreak would
// expose (the due index would otherwise hand back seq order by itself).
it("drain: events raised in one transaction are handled in seq order", async () => {
  await parkOthers();
  await db()`SET LOCAL enable_indexscan = off`;
  await db()`SET LOCAL enable_bitmapscan = off`;
  const ids: string[] = [];
  for (const type of ["A", "B", "C"]) {
    const [r] = await db()`
      INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
      VALUES (${type}, 'class', ${crypto.randomUUID()}, '{}') RETURNING id`;
    ids.push(r.id);
  }
  await db()`UPDATE event_outbox SET last_error = 'touched' WHERE id = ${ids[0]}`;
  const [same] = await db()`
    SELECT count(DISTINCT created_at) AS c FROM event_outbox WHERE id = ANY(${ids}::uuid[])`;
  assert.equal(Number(same.c), 1);
  const seen: string[] = [];
  const h: EventHandler = async (e) => {
    seen.push(e.type);
  };
  await drainOutbox({ handlers: { A: h, B: h, C: h } });
  assert.deepEqual(seen, ["A", "B", "C"]);
});

it("retryDeadEvents: revives a dead row (attempts 0, dead_at NULL, due now) and the next drain processes it", async () => {
  await parkOthers();
  const [id] = await insertEvents(1, "ClassPublished", MAX_ATTEMPTS);
  await db()`
    UPDATE event_outbox
    SET dead_at = now(), last_error = 'old', next_attempt_at = now() + interval '1 day'
    WHERE id = ${id}`;
  assert.equal(await retryDeadEvents([id]), 1);
  const x = await row(id);
  assert.equal(x.attempts, 0);
  assert.equal(x.dead_at, null);
  const [t] =
    await db()`SELECT next_attempt_at <= now() AS due FROM event_outbox WHERE id = ${id}`;
  assert.equal(t.due, true);
  const r = await drainOutbox({ handlers: {} });
  assert.deepEqual(r, { claimed: 1, processed: 1, failed: 0, dead: 0 });
  assert.notEqual((await row(id)).processed_at, null);
});

it("retryDeadEvents: no ids revives every dead row; live rows and unknown ids are untouched", async () => {
  await parkOthers();
  const [d1, d2, live] = await insertEvents(3, "ClassPublished", MAX_ATTEMPTS);
  await db()`UPDATE event_outbox SET dead_at = now() WHERE id = ANY(${[d1, d2]}::uuid[])`;
  assert.equal(await retryDeadEvents([live, crypto.randomUUID()]), 0);
  assert.equal(await retryDeadEvents([]), 0);
  assert.notEqual((await row(d1)).dead_at, null);
  assert.equal(await retryDeadEvents(), 2);
  assert.equal((await row(d1)).dead_at, null);
  assert.equal((await row(d2)).attempts, 0);
  assert.equal((await row(live)).attempts, MAX_ATTEMPTS);
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

// Rows are back-dated ~10 years in next_attempt_at (the claim order) so they
// are the first claimable rows and fill both batches exactly, whatever else is
// in the database.
test(
  "drain: two concurrent drains never process the same row",
  { skip },
  async () => {
    const ids: string[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const [r] = await db()`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, next_attempt_at)
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
          INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, next_attempt_at)
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
        // batch 2, not 3: the DB may hold other due events (class triggers
        // write ClassPublished rows other test files leave committed); ours
        // are 10 years old, so they come first and fill the batch.
        drainOutbox({ batch: 2, handlers }),
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
