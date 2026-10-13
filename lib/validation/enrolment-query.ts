import { z } from "zod";
import { ENROLMENT_STATUSES } from "../enrolments/status-rules.ts";

// Query shape for GET /api/enrolments (spec §7 list conventions, §9.11 list).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick one from the list",
  );

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

// §7 sort=: allow-list only, so sorting can never reach a column the list
// doesn't show. `-` prefix is descending.
export const ENROLMENT_SORTS = [
  "enrolled",
  "-enrolled",
  "person",
  "-person",
  "class",
  "-class",
  "status",
  "-status",
] as const;

// Upcoming by default, toggle for past — the §9.8 split, decided by the
// server because only the server knows the Kuala Lumpur day (§4).
export const ENROLMENT_WHEN = ["upcoming", "past"] as const;

export const enrolmentListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  when: z.enum(ENROLMENT_WHEN).default("upcoming"),
  classId: uuid.optional(),
  courseId: uuid.optional(),
  status: z.enum(ENROLMENT_STATUSES).optional(),
  payerType: z.enum(["self", "company"]).optional(),
  // Whether the enrolment stores a price (§5), not whether money arrived —
  // that lives in `payment`, which §6 hides from support, and a filter that
  // returned different rows per role would be worse than none.
  hasPrice: bool,
  enrolledFrom: z.iso.date().optional(),
  enrolledTo: z.iso.date().optional(),
  sort: z.enum(ENROLMENT_SORTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // §14: never more than 100 rows at once, anywhere.
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type EnrolmentListQuery = z.output<typeof enrolmentListQuerySchema>;

// §7 URL shape: ?q=&when=&sort=&page=&limit=&filter[...].
export function readEnrolmentParams(sp: URLSearchParams) {
  return {
    q: sp.get("q") ?? undefined,
    when: sp.get("when") ?? undefined,
    classId: sp.get("filter[classId]") ?? undefined,
    courseId: sp.get("filter[courseId]") ?? undefined,
    status: sp.get("filter[status]") ?? undefined,
    payerType: sp.get("filter[payerType]") ?? undefined,
    hasPrice: sp.get("filter[hasPrice]") ?? undefined,
    enrolledFrom: sp.get("filter[enrolledFrom]") ?? undefined,
    enrolledTo: sp.get("filter[enrolledTo]") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  };
}
