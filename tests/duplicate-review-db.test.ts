// Spec §12.2 rule 3 + §7.1: the pair a soft match records, and the way out
// of the queue when it was a false positive. Against the seeded dev database,
// every test rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import {
  clearReviewFlag,
  openPairFor,
  raiseDuplicateTask,
} from "../lib/people/duplicate-review.ts";
import { getPersonDetail } from "../lib/people/detail-service.ts";
import { createPerson } from "../lib/people/service.ts";
import { closeDb, db, rollbackAfter, withTransaction } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };
const support: Viewer = { id: SEED_USERS.weiPing, role: "support" };
const operations: Viewer = { id: SEED_USERS.weiPing, role: "operations" };
const partTime: Viewer = { id: SEED_USERS.leeYee, role: "part_time" };
const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const management: Viewer = { id: SEED_USERS.admin, role: "management" };

// A person nobody else matches, to match against on purpose.
async function seedPerson(fullName: string, email?: string) {
  const [row] = await db()`
    INSERT INTO person (full_name, email)
    VALUES (${fullName}, ${email ?? null})
    RETURNING id`;
  return row.id as string;
}

const auditCount = async () =>
  (await db()`SELECT count(*)::int AS n FROM audit_log`)[0].n as number;

const pairTasksFor = (personId: string) => db()`
  SELECT id, person_id, related_person_id, assigned_user_id, due_at, done_at
  FROM task
  WHERE type = 'review_duplicate'
    AND (person_id = ${personId} OR related_person_id = ${personId})`;

it("the pair task names both records and reaches a super admin", async () => {
  const candidate = await seedPerson("Pair Target");
  const flagged = await seedPerson("Pair Source");
  await raiseDuplicateTask(
    flagged,
    { id: candidate, fullName: "Pair Target" },
    admin,
  );

  const [task] = await pairTasksFor(flagged);
  assert.equal(task.person_id, flagged);
  assert.equal(task.related_person_id, candidate);
  // §9.0 My tasks reads by assignee and ignores a null due date, so both have
  // to be set or the task is invisible until §9.14 is built.
  assert.ok(task.assigned_user_id, "assigned to a super_admin");
  assert.ok(task.due_at, "due date set");

  const [{ role_code: role }] = await db()`
    SELECT role_code FROM app_user WHERE id = ${task.assigned_user_id}`;
  assert.equal(role, "super_admin");
});

it("no active super admin still records the pair, unassigned", async () => {
  // A database in this state is broken, but losing the pair would be worse
  // than an unassigned task (design 4).
  await db()`UPDATE app_user SET is_active = false WHERE role_code = 'super_admin'`;
  const candidate = await seedPerson("Orphan Target");
  const flagged = await seedPerson("Orphan Source");
  await raiseDuplicateTask(
    flagged,
    { id: candidate, fullName: "Orphan Target" },
    admin,
  );

  const [task] = await pairTasksFor(flagged);
  assert.equal(task.assigned_user_id, null);
  assert.equal(task.related_person_id, candidate);
});

it("a soft match on create writes the person and the pair together", async () => {
  const candidate = await seedPerson("Soft Match", "softmatch@gmail.com");
  // §12.2 rule 3(b): same normalised name, same email local part, different
  // domain. Different phones, so the hard match never fires first.
  const r = await createPerson(
    {
      fullName: "SOFT  MATCH",
      email: "softmatch@acme.com",
      preferredLanguage: "en",
    },
    admin,
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.equal(r.person.needsReview, true);

  const [task] = await pairTasksFor(r.person.id);
  assert.equal(task.related_person_id, candidate);
  assert.equal(task.person_id, r.person.id, "the new record is the subject");
});

it("a flag that is not a pair raises no task", async () => {
  const r = await createPerson(
    { fullName: "Bad Phone Only", phone: "999", preferredLanguage: "en" },
    admin,
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.equal(r.person.needsReview, true);
  assert.equal((await pairTasksFor(r.person.id)).length, 0);
});

it("a clean create raises no task", async () => {
  const r = await createPerson(
    { fullName: "Nobody Like Me At All", preferredLanguage: "en" },
    admin,
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.equal(r.person.needsReview, false);
  assert.equal((await pairTasksFor(r.person.id)).length, 0);
});

it("a hard match creates neither person nor task", async () => {
  const before = await db()`
    SELECT count(*)::int AS n FROM task WHERE type = 'review_duplicate'`;
  await seedPerson("Hard Match", "hardmatch@gmail.com");
  const r = await createPerson(
    {
      fullName: "Hard Match",
      email: "hardmatch@gmail.com",
      preferredLanguage: "en",
    },
    admin,
  );
  assert.equal(r.kind, "duplicate");
  const after = await db()`
    SELECT count(*)::int AS n FROM task WHERE type = 'review_duplicate'`;
  assert.equal(after[0].n, before[0].n);
});

it("a create that fails after the match leaves no task behind", async () => {
  await seedPerson("Rollback Pair", "rollbackpair@gmail.com");
  const before = await db()`
    SELECT count(*)::int AS n FROM task WHERE type = 'review_duplicate'`;

  // withTransaction nests on a savepoint inside this test's transaction
  // (lib/sql.ts), so failing inside it undoes the create and the task while
  // the test's own rollback still works.
  await withTransaction(async () => {
    const r = await createPerson(
      {
        fullName: "Rollback Pair",
        email: "rollbackpair@acme.com",
        preferredLanguage: "en",
      },
      admin,
    );
    assert.equal(r.kind, "created");
    throw new Error("undo the create");
  }).catch(() => {});

  const after = await db()`
    SELECT count(*)::int AS n FROM task WHERE type = 'review_duplicate'`;
  assert.equal(after[0].n, before[0].n);
});

it("the detail read names the record the person may duplicate", async () => {
  const candidate = await seedPerson("Detail Target", "detailtarget@gmail.com");
  const r = await createPerson(
    {
      fullName: "Detail Target",
      email: "detailtarget@acme.com",
      preferredLanguage: "en",
    },
    admin,
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;

  const got = await getPersonDetail(r.person.id, admin);
  assert.equal(got.kind, "ok");
  if (got.kind !== "ok") return;
  assert.deepEqual(got.detail.person.duplicateOf, {
    id: candidate,
    fullName: "Detail Target",
  });
});

it("an unflagged person has no pair", async () => {
  const id = await seedPerson("Plain Person");
  const got = await getPersonDetail(id, admin);
  assert.equal(got.kind === "ok" && got.detail.person.duplicateOf, null);
});

it("a closed pair task stops being offered", async () => {
  const candidate = await seedPerson("Closed Pair", "closedpair@gmail.com");
  const flagged = await seedPerson("Closed Pair");
  await db()`UPDATE person SET needs_review = true,
             needs_review_reason = 'possible_duplicate_email' WHERE id = ${flagged}`;
  await raiseDuplicateTask(
    flagged,
    { id: candidate, fullName: "Closed Pair" },
    admin,
  );
  assert.ok(await openPairFor(flagged));

  await db()`UPDATE task SET done_at = now(), done_by = ${admin.id}
             WHERE type = 'review_duplicate' AND person_id = ${flagged}`;
  assert.equal(await openPairFor(flagged), null);
});

it("a pair whose other record is gone is not offered", async () => {
  // Each of the three ways a record leaves: §9.3 merge, soft delete, §12.10
  // erasure. §9.3 could not open on any of them.
  for (const gone of [
    "merged_into_id = (SELECT id FROM person WHERE full_name = 'Pair Survivor')",
    "deleted_at = now()",
    "erased_at = now()",
  ]) {
    await db()`INSERT INTO person (full_name) VALUES ('Pair Survivor')`;
    const candidate = await seedPerson("Gone Target");
    const flagged = await seedPerson("Gone Source");
    await raiseDuplicateTask(
      flagged,
      { id: candidate, fullName: "Gone Target" },
      admin,
    );
    assert.ok(await openPairFor(flagged), `pair offered before ${gone}`);

    await db().unsafe(`UPDATE person SET ${gone} WHERE id = '${candidate}'`);
    assert.equal(
      await openPairFor(flagged),
      null,
      `still offered after ${gone}`,
    );
  }
});

// A flagged person with a recorded pair, the state the dismiss acts on.
async function seedFlaggedPair(reason = "possible_duplicate_company") {
  const candidate = await seedPerson("Dismiss Target");
  const flagged = await seedPerson("Dismiss Source");
  await db()`UPDATE person SET needs_review = true,
             needs_review_reason = ${reason}
             WHERE id = ${flagged}`;
  await raiseDuplicateTask(
    flagged,
    { id: candidate, fullName: "Dismiss Target" },
    admin,
  );
  const [row] =
    await db()`SELECT version::int AS v FROM person WHERE id = ${flagged}`;
  return { flagged, candidate, version: row.v as number };
}

it("dismissing clears the flag, closes the task and says what it cleared", async () => {
  const { flagged, candidate, version } = await seedFlaggedPair();
  const r = await clearReviewFlag(flagged, "different people", version, admin);
  assert.equal(r.kind, "dismissed");

  const [person] = await db()`
    SELECT needs_review, needs_review_reason FROM person WHERE id = ${flagged}`;
  assert.equal(person.needs_review, false);
  // §5 CHECK: the flag and its reason are cleared together.
  assert.equal(person.needs_review_reason, null);

  const [task] = await pairTasksFor(flagged);
  assert.ok(task.done_at, "pair task closed");

  const [audit] = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'person' AND entity_id = ${flagged} AND action = 'update'
    ORDER BY at DESC LIMIT 1`;
  assert.equal(audit.before.needsReviewReason, "possible_duplicate_company");
  assert.equal(audit.before.duplicateOf, candidate);
  assert.equal(audit.after.note, "different people");
});

it("dismissing leaves the other record alone", async () => {
  const { flagged, candidate, version } = await seedFlaggedPair();
  await clearReviewFlag(flagged, undefined, version, admin);
  const [other] = await db()`
    SELECT needs_review, merged_into_id, deleted_at FROM person WHERE id = ${candidate}`;
  assert.equal(other.needs_review, false);
  assert.equal(other.merged_into_id, null);
  assert.equal(other.deleted_at, null);
  assert.equal(flagged === candidate, false);
});

it("the queue roles may dismiss; the others may not", async () => {
  // §6 person row: F for super_admin, E for sales and support. Operations
  // and management read people without writing them, part_time's "A" covers
  // only their own records, and marketing has read alone.
  for (const viewer of [admin, sales, support]) {
    const { flagged, version } = await seedFlaggedPair();
    const r = await clearReviewFlag(flagged, undefined, version, viewer);
    assert.equal(r.kind, "dismissed", `${viewer.role} should be able to`);
  }
  for (const viewer of [operations, partTime, marketing, management]) {
    const { flagged, version } = await seedFlaggedPair();
    const r = await clearReviewFlag(flagged, undefined, version, viewer);
    assert.equal(r.kind, "forbidden", `${viewer.role} should not`);
    const [person] =
      await db()`SELECT needs_review FROM person WHERE id = ${flagged}`;
    assert.equal(person.needs_review, true);
  }
});

// §12.2: a record flagged before pairs were kept, or one whose candidate has
// since been merged away, has no task to close — the route needs only the
// flag, so it stays dismissible.
it("a pair reason with no open task is still dismissible", async () => {
  const flagged = await seedPerson("No Task Source");
  await db()`UPDATE person SET needs_review = true,
             needs_review_reason = 'possible_duplicate_email'
             WHERE id = ${flagged}`;
  const [row] =
    await db()`SELECT version::int AS v FROM person WHERE id = ${flagged}`;
  assert.equal(await openPairFor(flagged), null, "no pair recorded");

  const r = await clearReviewFlag(flagged, undefined, row.v, admin);
  assert.equal(r.kind, "dismissed");
  const [person] = await db()`
    SELECT needs_review, needs_review_reason FROM person WHERE id = ${flagged}`;
  assert.equal(person.needs_review, false);
  assert.equal(person.needs_review_reason, null);

  const [audit] = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'person' AND entity_id = ${flagged} AND action = 'update'
    ORDER BY at DESC LIMIT 1`;
  assert.equal(audit.before.needsReviewReason, "possible_duplicate_email");
  assert.equal(audit.before.duplicateOf, null);
  assert.equal(audit.after.notADuplicate, true);
});

it("a stale version is refused and the flag stays", async () => {
  const { flagged, version } = await seedFlaggedPair();
  const r = await clearReviewFlag(flagged, undefined, version + 1, admin);
  assert.equal(r.kind, "stale");
  const [person] =
    await db()`SELECT needs_review FROM person WHERE id = ${flagged}`;
  assert.equal(person.needs_review, true);
});

// §12.2 (O50): `no_name` and `phone_unnormalised` name a defect in the record
// itself. The pair task here is set up anyway, so the test can prove a
// refused dismissal closes nothing.
it("a flag about this record alone is not a pair to dismiss", async () => {
  for (const reason of ["no_name", "phone_unnormalised"]) {
    const { flagged, version } = await seedFlaggedPair(reason);
    const audits = await auditCount();
    const r = await clearReviewFlag(flagged, "mine", version, admin);
    assert.equal(r.kind, "not_a_pair", reason);

    const [person] = await db()`
      SELECT needs_review, needs_review_reason FROM person WHERE id = ${flagged}`;
    assert.equal(person.needs_review, true, reason);
    assert.equal(person.needs_review_reason, reason);
    const [task] = await pairTasksFor(flagged);
    assert.equal(task.done_at, null, `task left open for ${reason}`);
    assert.equal(await auditCount(), audits, `nothing logged for ${reason}`);
  }
});

// Reloading cannot turn a record defect into a pair, so the refusal that
// stands must be the permanent one — a `stale_edit` would invite a retry.
it("not a pair outranks a stale version", async () => {
  const { flagged, version } = await seedFlaggedPair("no_name");
  const r = await clearReviewFlag(flagged, undefined, version + 1, admin);
  assert.equal(r.kind, "not_a_pair");
});

it("a second dismissal is refused rather than reported as done", async () => {
  const { flagged, version } = await seedFlaggedPair();
  assert.equal(
    (await clearReviewFlag(flagged, undefined, version, admin)).kind,
    "dismissed",
  );
  const [row] =
    await db()`SELECT version::int AS v FROM person WHERE id = ${flagged}`;
  const second = await clearReviewFlag(flagged, undefined, row.v, admin);
  assert.equal(second.kind, "not_flagged");
});

it("a person who is gone is not found", async () => {
  const { flagged, version } = await seedFlaggedPair();
  await db()`UPDATE person SET deleted_at = now() WHERE id = ${flagged}`;
  assert.equal(
    (await clearReviewFlag(flagged, undefined, version, admin)).kind,
    "not_found",
  );
});

it("merging is still the other way out of the queue", async () => {
  const { flagged, candidate } = await seedFlaggedPair();
  await db()`SELECT merge_person(${flagged}, ${candidate}, ${admin.id})`;
  const [task] = await pairTasksFor(candidate);
  assert.ok(task.done_at, "merge_person closed the pair task");
  const [gone] = await db()`
    SELECT merged_into_id FROM person WHERE id = ${flagged}`;
  assert.equal(gone.merged_into_id, candidate);
});
