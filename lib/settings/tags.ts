import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { TagUpdate } from "../validation/tag.ts";

// Spec §9.15 Tags, §7.1. super_admin only; the routes check. System tags
// are read-only; nothing deletes a tag. Tags are still created by bulk add
// tag and the imports, not here.

export type TagRow = {
  id: string;
  version: number;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  personCount: number;
};

export type TagWriteResult =
  | { kind: "ok"; tag: TagRow }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "system_tag" }
  // 409, naming the tag that already has the name, so the screen can offer
  // a merge instead.
  | { kind: "duplicate_name"; existing: { id: string; name: string } };

export type TagMergeResult =
  | { kind: "ok"; moved: number }
  | { kind: "not_found" }
  | { kind: "system_tag" }
  // 422: the target is the source, inactive or unknown.
  | { kind: "bad_target" };

const toRow = (r: postgres.Row): TagRow => ({
  id: r.id,
  version: Number(r.version),
  name: r.name,
  isSystem: r.is_system,
  isActive: r.is_active,
  personCount: Number(r.person_count ?? 0),
});

// Design 9: person counts come with the list, in one query.
async function readTags(id?: string): Promise<TagRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, coalesce(pt.n, 0) AS person_count
    FROM tag t
    LEFT JOIN (SELECT tag_id, count(*) AS n FROM person_tag GROUP BY tag_id) pt
      ON pt.tag_id = t.id
    ${id ? sql`WHERE t.id = ${id}` : sql``}
    ORDER BY lower(t.name), t.id`;
  return rows.map(toRow);
}

export const listAllTags = () => readTags();

const COLUMNS = { name: "name", isActive: "is_active" } as const;

export async function updateTag(
  id: string,
  body: TagUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<TagWriteResult> {
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<TagWriteResult> => {
    const sql = db();
    const [before] = await sql`SELECT * FROM tag WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    if (before.is_system) return { kind: "system_tag" };
    if (Number(before.version) !== ifMatch) return { kind: "stale" };

    const changed = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (k) => body[k] !== undefined && body[k] !== before[COLUMNS[k]],
    );
    if (changed.length) {
      try {
        // Own savepoint: tag_name_uq must not abort the caller (lib/sql.ts).
        await withTransaction(
          () => db()`
            UPDATE tag
            SET ${sql(Object.fromEntries(changed.map((k) => [COLUMNS[k], body[k]])))}
            WHERE id = ${id}`,
        );
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
        const [other] = await sql`
          SELECT id, name FROM tag WHERE lower(name) = lower(${body.name!})`;
        return {
          kind: "duplicate_name",
          existing: { id: other.id, name: other.name },
        };
      }
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "tag",
        entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, before[COLUMNS[k]]])),
        after: Object.fromEntries(changed.map((k) => [k, body[k]])),
      });
    }
    const [tag] = await readTags(id);
    return { kind: "ok", tag };
  });
}

// Design 8: one transaction. Not a person merge, so the migration-002
// functions are not involved. Takes no If-Match: the result doesn't depend on
// anything the user was editing, and the audit row keeps the true count.
export async function mergeTag(
  sourceId: string,
  intoId: string,
  viewer: Viewer,
): Promise<TagMergeResult> {
  if (!isUuid(sourceId)) return { kind: "not_found" };
  if (!isUuid(intoId) || intoId === sourceId) return { kind: "bad_target" };
  return withTransaction(async (): Promise<TagMergeResult> => {
    const sql = db();
    // Locked in id order, so two opposite merges can't deadlock.
    const rows = await sql`
      SELECT id, is_system, is_active FROM tag
      WHERE id IN (${sourceId}, ${intoId}) ORDER BY id FOR UPDATE`;
    const source = rows.find((r) => r.id === sourceId);
    const into = rows.find((r) => r.id === intoId);
    if (!source) return { kind: "not_found" };
    if (source.is_system) return { kind: "system_tag" };
    if (!into?.is_active) return { kind: "bad_target" };

    await sql`
      INSERT INTO person_tag (person_id, tag_id, tagged_at, tagged_by)
      SELECT person_id, ${intoId}, now(), ${viewer.id}
      FROM person_tag WHERE tag_id = ${sourceId}
      ON CONFLICT DO NOTHING`;
    // The spec counts people taken off the source, including those who
    // already had the target (30 + 50 with 10 shared: "30 were moved").
    const { count: moved } = await sql`
      DELETE FROM person_tag WHERE tag_id = ${sourceId}`;
    await sql`UPDATE tag SET is_active = false WHERE id = ${sourceId}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "tag",
      entityId: sourceId,
      before: null,
      after: { mergedInto: intoId, moved },
    });
    return { kind: "ok", moved };
  });
}
