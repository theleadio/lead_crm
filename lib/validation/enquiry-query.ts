import { z } from "zod";
import {
  ENQUIRY_CATEGORIES,
  ENQUIRY_CHANNELS,
  ENQUIRY_STATUSES,
} from "../enquiries/types.ts";

// Query shape for GET /api/enquiries (spec §7 list conventions, §9.13).

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick one from the list",
  );

// §7 sort=: allow-list only. `age` is the waiting time, so ascending is the
// longest-waiting first, the same order as no sort at all.
export const ENQUIRY_SORTS = [
  "age",
  "-age",
  "firstMessage",
  "-firstMessage",
  "status",
  "-status",
] as const;

export const enquiryListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  // No status means `open` (§9.13 default); `all` lifts that.
  status: z.enum([...ENQUIRY_STATUSES, "all"]).default("open"),
  category: z.enum(ENQUIRY_CATEGORIES).optional(),
  channel: z.enum(ENQUIRY_CHANNELS).optional(),
  assignee: z.union([uuid, z.literal("unassigned")]).optional(),
  mine: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sort: z.enum(ENQUIRY_SORTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // §14: never more than 100 rows at once; a larger ask is refused, not cut.
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type EnquiryListQuery = z.output<typeof enquiryListQuerySchema>;

// §7 URL shape: ?q=&sort=&page=&limit=&filter[...].
export function readEnquiryParams(sp: URLSearchParams) {
  return {
    q: sp.get("q") ?? undefined,
    status: sp.get("filter[status]") ?? undefined,
    category: sp.get("filter[category]") ?? undefined,
    channel: sp.get("filter[channel]") ?? undefined,
    assignee: sp.get("filter[assignee]") ?? undefined,
    mine: sp.get("filter[mine]") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  };
}
