import { z } from "zod";
import { CLASS_LANGUAGES, CLASS_STATUSES } from "../classes/types.ts";

// Query shape for GET /api/classes (spec §7 list conventions, §9.8).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick a course from the list",
  );

// §7 sort=: allow-list only, so sorting can never reach a column the list
// doesn't show. `-` prefix is descending.
export const CLASS_SORTS = [
  "start",
  "-start",
  "code",
  "-code",
  "course",
  "-course",
] as const;

// §9.8: upcoming only by default, toggle for past. "Upcoming" is decided by
// the server, not a client-supplied date range — only the server knows the
// Kuala Lumpur day (§4).
export const CLASS_WHEN = ["upcoming", "past"] as const;

export const classListQuerySchema = z.object({
  when: z.enum(CLASS_WHEN).default("upcoming"),
  courseId: uuid.optional(),
  status: z.enum(CLASS_STATUSES).optional(),
  language: z.enum(CLASS_LANGUAGES).optional(),
  sort: z.enum(CLASS_SORTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // §14: never more than 100 rows at once, anywhere.
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ClassListQuery = z.output<typeof classListQuerySchema>;

// §7 URL shape: ?when=&sort=&page=&limit=&filter[...].
export function readClassParams(sp: URLSearchParams) {
  return {
    when: sp.get("when") ?? undefined,
    courseId: sp.get("filter[courseId]") ?? undefined,
    status: sp.get("filter[status]") ?? undefined,
    language: sp.get("filter[language]") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  };
}
