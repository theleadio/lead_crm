import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type {
  LostReasonCreate,
  LostReasonUpdate,
} from "../validation/lost-reason.ts";

// Spec §9.15 Lost reasons, §7.1. super_admin only; the routes check. Nothing
// deletes a reason: deals and reports keep theirs (§5).

export type LostReasonRow = {
  id: string;
  version: number;
  code: string;
  labelEn: string;
  labelZh: string | null;
  isActive: boolean;
  dealCount: number;
};

export type LostReasonWriteResult =
  | { kind: "ok"; reason: LostReasonRow }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "duplicate_code" };

// Design 7: one lock for everything that sets sort_order.
const lockOrder = () =>
  db()`SELECT pg_advisory_xact_lock(hashtext('lost_reason_order'))`;

const toRow = (r: postgres.Row): LostReasonRow => ({
  id: r.id,
  version: Number(r.version),
  code: r.code,
  labelEn: r.label_en,
  labelZh: r.label_zh,
  isActive: r.is_active,
  dealCount: Number(r.deal_count ?? 0),
});

// Design 9: the deal count comes with the list, in one query.
async function readReasons(id?: string): Promise<LostReasonRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT r.*, coalesce(d.n, 0) AS deal_count
    FROM lost_reason r
    LEFT JOIN (SELECT lost_reason_id, count(*) AS n FROM deal
               GROUP BY lost_reason_id) d ON d.lost_reason_id = r.id
    ${id ? sql`WHERE r.id = ${id}` : sql``}
    ORDER BY r.sort_order, r.label_en, r.id`;
  return rows.map(toRow);
}

export const listAllLostReasons = () => readReasons();

export async function createLostReason(
  input: LostReasonCreate,
  viewer: Viewer,
): Promise<LostReasonWriteResult> {
  return withTransaction(async () => {
    await lockOrder();
    let id: string;
    try {
      // Own savepoint, so the unique violation doesn't abort the caller.
      [{ id }] = await withTransaction(
        () => db()`
          INSERT INTO lost_reason (code, label_en, label_zh, sort_order, created_by)
          SELECT ${input.code}, ${input.labelEn}, ${input.labelZh},
                 coalesce(max(sort_order), 0) + 1, ${viewer.id}
          FROM lost_reason
          RETURNING id`,
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505")
        return { kind: "duplicate_code" } as const;
      throw err;
    }
    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "lost_reason",
      entityId: id,
      before: null,
      after: input,
    });
    const [reason] = await readReasons(id);
    return { kind: "ok", reason } as const;
  });
}

const COLUMNS = {
  labelEn: "label_en",
  labelZh: "label_zh",
  isActive: "is_active",
} as const;

export async function updateLostReason(
  id: string,
  body: LostReasonUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<LostReasonWriteResult> {
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async () => {
    const sql = db();
    const [before] = await sql`
      SELECT * FROM lost_reason WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" } as const;
    if (Number(before.version) !== ifMatch) return { kind: "stale" } as const;

    const changed = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
      (k) => body[k] !== undefined && body[k] !== before[COLUMNS[k]],
    );
    if (changed.length) {
      await sql`
        UPDATE lost_reason
        SET ${sql(Object.fromEntries(changed.map((k) => [COLUMNS[k], body[k]])))}
        WHERE id = ${id}`;
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "lost_reason",
        entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, before[COLUMNS[k]]])),
        after: Object.fromEntries(changed.map((k) => [k, body[k]])),
      });
    }
    const [reason] = await readReasons(id);
    return { kind: "ok", reason } as const;
  });
}

// Design 7: `ids` must name every reason exactly once, else nothing changes.
export async function reorderLostReasons(
  ids: string[],
  viewer: Viewer,
): Promise<{ kind: "ok" } | { kind: "incomplete" }> {
  return withTransaction(async () => {
    const sql = db();
    await lockOrder();
    const before = (
      await sql`SELECT id FROM lost_reason ORDER BY sort_order, label_en, id`
    ).map((r) => r.id as string);
    const known = new Set(before);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== before.length ||
      !ids.every((id) => known.has(id))
    )
      return { kind: "incomplete" } as const;

    await sql`
      UPDATE lost_reason r SET sort_order = o.n
      FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS o(id, n)
      WHERE r.id = o.id AND r.sort_order IS DISTINCT FROM o.n`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "lost_reason",
      entityId: null,
      before: { order: before },
      after: { order: ids },
    });
    return { kind: "ok" } as const;
  });
}
