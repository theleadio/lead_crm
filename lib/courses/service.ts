import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import { canWriteCourse, type Viewer } from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import type { ListResponse } from "../people/types.ts";
import { db, withTransaction } from "../sql.ts";
import type {
  CourseCreate,
  CourseListQuery,
  CourseUpdate,
} from "../validation/course.ts";

// Service layer for courses (spec §7 GET/POST/PATCH /api/courses, §9.7).
// Courses fall under the `course/class` row of the §6 matrix: every role
// reads, super_admin and operations write.

export type CourseListItem = {
  id: string;
  code: string;
  nameEn: string;
  nameZh: string | null;
  track: string;
  durationDays: number;
  // numeric(12,2) as text (spec §4).
  listPriceMyr: string | null;
  hrdcClaimable: boolean;
  isActive: boolean;
  // Integer row version (migration 005); sent back as If-Match (§7 v1.7).
  version: number;
};

export type CourseWriteResult =
  | { kind: "ok"; id: string; version: number }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  // The code is taken (§9.7): name the holder so the user reactivates it
  // instead of making a second record.
  | { kind: "duplicate"; code: string; nameEn: string };

// Spec §7 sort=: allow-list only, so sorting can never reach a column the
// list doesn't show. Ties break on id, so paging is stable. Default is the
// order the 9.5 filter and the deal course pickers already render.
function orderSql(sql: postgres.Sql, sort: CourseListQuery["sort"]) {
  const dir = sort?.startsWith("-") ? sql`DESC` : sql`ASC`;
  switch (sort?.replace("-", "")) {
    case "code":
      return sql`code ${dir}, id`;
    case "created":
      return sql`created_at ${dir}, id`;
    default:
      return sql`lower(name_en) ${dir}, id`;
  }
}

// All courses by default, so deals on a retired course stay findable;
// `active` narrows to the ones a new deal may use (§9.5 v1.6).
export async function listCourses(
  q: CourseListQuery,
): Promise<ListResponse<CourseListItem>> {
  const sql = db();
  // No `active` = active and retired together, so deals on a retired course
  // stay findable (§9.5 v1.6). `active=true` is what the pickers ask for;
  // `active=false` is the 9.7 screen's "Retired only".
  const where =
    q.active === undefined
      ? sql`true`
      : q.active
        ? sql`is_active`
        : sql`NOT is_active`;
  const [[{ total }], rows] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM course WHERE ${where}`,
    sql`SELECT id, code, name_en, name_zh, track, duration_days, list_price_myr,
               hrdc_claimable, is_active, version
        FROM course WHERE ${where}
        ORDER BY ${orderSql(sql, q.sort)}
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
  ]);
  return {
    data: rows.map(toItem),
    page: { total, page: q.page, limit: q.limit },
  };
}

function toItem(r: Record<string, unknown>): CourseListItem {
  return {
    id: r.id as string,
    code: r.code as string,
    nameEn: r.name_en as string,
    nameZh: r.name_zh as string | null,
    track: r.track as string,
    durationDays: r.duration_days as number,
    listPriceMyr: r.list_price_myr as string | null,
    hrdcClaimable: r.hrdc_claimable as boolean,
    isActive: r.is_active as boolean,
    // bigint comes back as a string from postgres.js.
    version: Number(r.version),
  };
}

// Blank price means "no list price", not zero (§5: list_price_myr nullable).
const priceOrNull = (p: string | null | undefined) =>
  p === undefined || p === null || p.trim() === "" ? null : p.trim();

async function codeHolder(code: string, exceptId?: string) {
  const sql = db();
  const [row] = exceptId
    ? await sql`SELECT code, name_en FROM course
                WHERE code = ${code} AND id <> ${exceptId}`
    : await sql`SELECT code, name_en FROM course WHERE code = ${code}`;
  return row
    ? { code: row.code as string, nameEn: row.name_en as string }
    : null;
}

// POST /api/courses — §9.7. ON CONFLICT instead of catching the unique
// violation: an error would abort the surrounding transaction (and the one a
// DB test wraps around it), and this is race-safe without a savepoint.
export async function createCourse(
  input: CourseCreate,
  viewer: Viewer,
): Promise<CourseWriteResult> {
  if (!canWriteCourse(viewer)) return { kind: "forbidden" };
  return withTransaction(async (): Promise<CourseWriteResult> => {
    const sql = db();
    const row = {
      code: input.code,
      name_en: input.nameEn,
      name_zh: input.nameZh?.trim() || null,
      track: input.track,
      duration_days: input.durationDays,
      list_price_myr: priceOrNull(input.listPriceMyr),
      hrdc_claimable: input.hrdcClaimable,
      is_active: input.isActive,
      created_by: viewer.id,
    };
    const [created] = await sql`
      INSERT INTO course ${sql(row)}
      ON CONFLICT (code) DO NOTHING
      RETURNING id, version`;
    if (!created) {
      // Names the holder even when it is retired, so the user can reactivate.
      const holder = await codeHolder(input.code);
      return {
        kind: "duplicate",
        code: input.code,
        nameEn: holder?.nameEn ?? input.code,
      };
    }
    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "course",
      entityId: created.id,
      before: null,
      after: row,
    });
    return { kind: "ok", id: created.id, version: Number(created.version) };
  });
}

// PATCH /api/courses/:id — partial. Fields not sent keep their stored value,
// including description_en/description_zh, which the 9.7 form never shows.
export async function updateCourse(
  id: string,
  patch: CourseUpdate,
  ifMatch: number,
  viewer: Viewer,
): Promise<CourseWriteResult> {
  if (!canWriteCourse(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<CourseWriteResult> => {
    const sql = db();
    const [before] =
      await sql`SELECT * FROM course WHERE id = ${id} FOR UPDATE`;
    if (!before) return { kind: "not_found" };

    if (patch.code !== undefined) {
      const holder = await codeHolder(patch.code, id);
      if (holder) return { kind: "duplicate", ...holder };
    }

    const set: Record<string, string | number | boolean | null> = {};
    if (patch.code !== undefined) set.code = patch.code;
    if (patch.nameEn !== undefined) set.name_en = patch.nameEn;
    if (patch.nameZh !== undefined) set.name_zh = patch.nameZh.trim() || null;
    if (patch.track !== undefined) set.track = patch.track;
    if (patch.durationDays !== undefined)
      set.duration_days = patch.durationDays;
    if (patch.listPriceMyr !== undefined)
      set.list_price_myr = priceOrNull(patch.listPriceMyr);
    if (patch.hrdcClaimable !== undefined)
      set.hrdc_claimable = patch.hrdcClaimable;
    if (patch.isActive !== undefined) set.is_active = patch.isActive;

    const columns = Object.keys(set);
    // §7 (v1.7): a save that changes nothing still has to be based on the
    // current version, or it would be the one way to bypass the check.
    if (!columns.length)
      return Number(before.version) === ifMatch
        ? { kind: "ok", id, version: Number(before.version) }
        : { kind: "stale" };

    const [updated] = await sql`
      UPDATE course SET ${sql(set, columns)}
      WHERE id = ${id} AND version = ${ifMatch}
      RETURNING id, version`;
    // The row was read FOR UPDATE above, so it exists; no match means the
    // version moved under us.
    if (!updated) return { kind: "stale" };

    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "course",
      entityId: id,
      before: Object.fromEntries(columns.map((c) => [c, before[c] ?? null])),
      after: set,
    });
    return { kind: "ok", id, version: Number(updated.version) };
  });
}
