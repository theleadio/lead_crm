import { writeAudit } from "../audit.ts";
import { canReviewFlagged, type Viewer } from "../auth/permissions.ts";
import { db, withTransaction } from "../sql.ts";

// Spec §12.2 rule 3 + §7.1: what happens after the soft match flags someone.
// The pair is the `review_duplicate` task — `person_id` the new record,
// `related_person_id` the one they matched — because the schema already
// models it (migration 001) and `merge_person()` already closes it (002).
// Nothing here is a new column.
//
// Same shape as lib/deals/hrdc-task.ts: one module owns raising, reading and
// closing, called inside the caller's transaction so the task and the person
// commit together.

export type DuplicatePair = { id: string; fullName: string };

// §12.2: `phone_unnormalised` and `no_name` (§11.2) name a defect in one
// record rather than a proposed pair, so they raise no task, have no dismiss
// and clear through the person edit that fixes the record. Every other reason
// means §12.2 rule 3 matched someone.
const DEFECT_REASONS = ["phone_unnormalised", "no_name"];
export const reasonProposesPair = (reason: string | null): boolean =>
  reason !== null && !DEFECT_REASONS.includes(reason);

// §7.1: §9.3 merge is super_admin's alone, so the task goes to one of them.
// The longest-serving active one, deterministically — §9.0 My tasks reads by
// assignee, so an unassigned task is invisible while §9.14 is unbuilt.
// Null only in a database with no active super_admin, which is a broken
// install: the pair is still worth recording, so the task is raised
// unassigned rather than not at all (design 4).
export async function dutySuperAdmin(): Promise<string | null> {
  const [row] = await db()`
    SELECT id FROM app_user
    WHERE role_code = 'super_admin' AND is_active
    ORDER BY created_at, id
    LIMIT 1`;
  return row?.id ?? null;
}

// Called from createPerson on a soft match only. A hard match creates no
// person, and `phone_unnormalised` / `no_name` name a defect in one record
// rather than a pair, so neither raises a task.
export async function raiseDuplicateTask(
  newPersonId: string,
  candidate: DuplicatePair,
  // Null for the public form (§8.2): no signed-in user, `created_by` and the
  // audit actor are NULL (§4, system actor).
  viewer: Pick<Viewer, "id"> | null,
): Promise<void> {
  const sql = db();
  const assignee = await dutySuperAdmin();
  const [task] = await sql`
    INSERT INTO task (type, title, person_id, related_person_id,
                      assigned_user_id, due_at, created_by)
    VALUES ('review_duplicate',
            ${`Possible duplicate of ${candidate.fullName}`},
            ${newPersonId}, ${candidate.id}, ${assignee},
            now(), ${viewer?.id ?? null})
    RETURNING id`;
  await writeAudit({
    userId: viewer?.id ?? null,
    action: "create",
    entity: "task",
    entityId: task.id,
    before: null,
    after: {
      type: "review_duplicate",
      personId: newPersonId,
      relatedPersonId: candidate.id,
      assignedUserId: assignee,
    },
  });
}

// The other end of a flagged person's open pair task, for §9.2. Null when
// nothing was recorded (`phone_unnormalised`, `no_name`, or a person flagged
// before pairs were kept) and when the proposed record has since been merged
// away, deleted or erased — §9.3 could not open on it, so the screen must not
// offer it. `person_id` either way: the task is raised in one direction, but
// a merge can leave the surviving record holding the other end.
export async function openPairFor(
  personId: string,
): Promise<DuplicatePair | null> {
  const [row] = await db()`
    SELECT other.id, other.full_name
    FROM task t
    JOIN person other ON other.id = CASE WHEN t.person_id = ${personId}
                                         THEN t.related_person_id
                                         ELSE t.person_id END
    WHERE t.type = 'review_duplicate' AND t.done_at IS NULL
      AND (t.person_id = ${personId} OR t.related_person_id = ${personId})
      AND other.deleted_at IS NULL
      AND other.merged_into_id IS NULL
      AND other.erased_at IS NULL
    ORDER BY t.created_at
    LIMIT 1`;
  return row ? { id: row.id, fullName: row.full_name } : null;
}

export type DismissResult =
  | { kind: "dismissed" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  // The flag went while this request was in flight — someone else dismissed
  // it, or a merge took the record out of the queue.
  | { kind: "not_flagged" }
  // The flag names a defect in this record, so there is no pair to judge.
  | { kind: "not_a_pair" };

// §12.2: two people who really are different. Clearing the flag is not an
// edit of the person, so it is not part of PATCH /api/people/:id — a name
// change and "these are different people" must not look alike in §9.16.
export async function clearReviewFlag(
  personId: string,
  note: string | undefined,
  ifMatch: number,
  viewer: Viewer,
): Promise<DismissResult> {
  // §6: the roles that may act on a flagged person — person write, and not
  // the assigned-only kind, whose "A" covers their own records rather than
  // everyone else's queue. Same test the §9.0 panel uses.
  if (!canReviewFlagged(viewer)) return { kind: "forbidden" };

  return withTransaction(async () => {
    const sql = db();
    const [before] = await sql`
      SELECT needs_review, needs_review_reason, version::int AS version
      FROM person
      WHERE id = ${personId} AND deleted_at IS NULL AND merged_into_id IS NULL`;
    if (!before) return { kind: "not_found" };
    if (!before.needs_review) return { kind: "not_flagged" };
    // Before the version check: reloading cannot turn a record defect into a
    // pair, so a stale version here would invite a retry that fails anyway.
    if (!reasonProposesPair(before.needs_review_reason))
      return { kind: "not_a_pair" };
    if (before.version !== ifMatch) return { kind: "stale" };

    // The pair is read before the task is closed, so the audit row can say
    // which record had been proposed.
    const pair = await openPairFor(personId);

    // §5: needs_review and its reason are set and cleared together (CHECK).
    const [cleared] = await sql`
      UPDATE person SET needs_review = false, needs_review_reason = NULL
      WHERE id = ${personId} AND version = ${ifMatch}
      RETURNING id`;
    if (!cleared) return { kind: "stale" };

    await sql`
      UPDATE task SET done_at = now(), done_by = ${viewer.id}
      WHERE type = 'review_duplicate' AND done_at IS NULL
        AND (person_id = ${personId} OR related_person_id = ${personId})`;

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "person",
      entityId: personId,
      before: {
        needsReview: true,
        needsReviewReason: before.needs_review_reason,
        duplicateOf: pair?.id ?? null,
      },
      after: { needsReview: false, notADuplicate: true, note: note ?? null },
    });
    return { kind: "dismissed" };
  });
}
