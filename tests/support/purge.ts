// Test-only cleanup for committed-data tests. Lives under tests/ and is not a
// *.test.ts file, so the runner never executes it and no /lib or /app code can
// import it without reaching into tests/.
//
// enrolment_status_history is append-only (forbid_change trigger) and has an
// FK to enrolment, so a plain DELETE FROM enrolment is refused once a writer
// has recorded history. The history delete runs under
// session_replication_role = replica, which skips user triggers (the
// append-only one) but also FK enforcement; the role is set back to origin
// before the enrolment delete, so any row still pointing at the enrolment
// (payment, task, another enrolment's transferred_to_enrolment_id) makes it
// fail with a foreign-key error instead of leaving a dangling reference.
// Needs a superuser (true on the local test DB). audit_log rows are still
// never deleted.
import { db } from "../../lib/sql.ts";

export async function purgeEnrolments(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await db().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`DELETE FROM enrolment_status_history WHERE enrolment_id IN ${tx(ids)}`;
      await tx`SET LOCAL session_replication_role = origin`;
      await tx`DELETE FROM enrolment WHERE id IN ${tx(ids)}`;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "42501")
      throw new Error(
        "purgeEnrolments: committed-data tests need a superuser test DB " +
          "(SET session_replication_role was refused)",
        { cause: err },
      );
    throw err;
  }
}

// Every enrolment in the class, for cleanups keyed by class.
export async function purgeClassEnrolments(classId: string): Promise<void> {
  const rows = await db()`SELECT id FROM enrolment WHERE class_id = ${classId}`;
  await purgeEnrolments(rows.map((r) => r.id as string));
}
