import type { ListResponse } from "../people/types.ts";
import { db } from "../sql.ts";
import type { CourseListQuery } from "../validation/course.ts";

// Service layer for courses (spec §7 GET /api/courses, §9.7). Only the read
// is built so far (for the 9.5 course filter, v1.6); 9.7 adds create/edit.

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
};

// All courses by default, so deals on a retired course stay findable;
// `active` narrows to the ones a new deal may use (§9.5 v1.6).
export async function listCourses(
  q: CourseListQuery,
): Promise<ListResponse<CourseListItem>> {
  const sql = db();
  const where = q.active ? sql`is_active` : sql`true`;
  const [[{ total }], rows] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM course WHERE ${where}`,
    sql`SELECT id, code, name_en, name_zh, track, duration_days, list_price_myr,
               hrdc_claimable, is_active
        FROM course WHERE ${where}
        ORDER BY lower(name_en), id
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      nameEn: r.name_en,
      nameZh: r.name_zh,
      track: r.track,
      durationDays: r.duration_days,
      listPriceMyr: r.list_price_myr,
      hrdcClaimable: r.hrdc_claimable,
      isActive: r.is_active,
    })),
    page: { total, page: q.page, limit: q.limit },
  };
}
