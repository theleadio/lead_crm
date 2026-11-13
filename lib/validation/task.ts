import { z } from "zod";
import { CREATABLE_TYPES, TASK_TYPE_LABELS } from "../tasks/labels.ts";

// Bodies and query of /api/tasks (§7, §9.14). Mirrors lib/validation/enquiry.ts.

// Lower-cased, as Postgres returns ids, so an unchanged id sent in capitals
// never reads as a change (the assignee compare in lib/tasks/service.ts).
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Pick one from the list",
  )
  .transform((v) => v.toLowerCase());

const title = z
  .string()
  .trim()
  .min(1, "Say what needs doing")
  .max(200, "Keep the title under 200 characters");
// Empty clears the notes; the dialog sends "" for an emptied box.
const notes = z
  .string()
  .trim()
  .max(2000, "Keep the notes under 2,000 characters")
  .transform((v) => v || null)
  .nullable();
const dueDate = z.iso.date("Pick a date").nullable();
const dueTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:30")
  .nullable();
// null leaves the task unassigned (§9.14 Everyone view: "Unassigned").
const assignee = uuid.nullable();

// A time means nothing without its date (design 5).
const timeNeedsDate = (v: {
  dueDate?: string | null;
  dueTime?: string | null;
}) => !v.dueTime || !!v.dueDate;
const timeNeedsDateIssue = {
  message: "Pick a date for this time",
  path: ["dueTime"],
};

export const taskCreateSchema = z
  .object({
    // Exactly one of these: the record the task was added from.
    personId: uuid.optional(),
    dealId: uuid.optional(),
    enrolmentId: uuid.optional(),
    type: z.enum(CREATABLE_TYPES, "Pick call, follow up or task"),
    title,
    dueDate: dueDate.default(null),
    dueTime: dueTime.default(null),
    assignee: assignee.default(null),
    notes: notes.default(null),
  })
  .refine(
    (v) => [v.personId, v.dealId, v.enrolmentId].filter(Boolean).length === 1,
    {
      message: "A task belongs to one person, deal or enrolment",
      // A path, or validationError() drops the message (it keys by field).
      path: ["personId"],
    },
  )
  .refine(timeNeedsDate, timeNeedsDateIssue);
export type TaskCreate = z.output<typeof taskCreateSchema>;

// One PATCH, three actions (design 2). Type and links never change.
export const taskUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reopen") }),
  z
    .object({
      action: z.literal("edit"),
      title: title.optional(),
      dueDate: dueDate.optional(),
      dueTime: dueTime.optional(),
      assignee: assignee.optional(),
      notes: notes.optional(),
    })
    .refine(timeNeedsDate, timeNeedsDateIssue),
]);
export type TaskUpdate = z.output<typeof taskUpdateSchema>;

export const TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as [
  string,
  ...string[],
];

// The Tasks screen's page size; the API default too.
export const TASKS_PAGE_SIZE = 25;

export const taskListQuerySchema = z
  .object({
    // §7: filter[mine]=true is the default view. A part-timer gets their own
    // tasks whatever this says (the WHERE clause, lib/tasks/list.ts).
    mine: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    assignee: z.union([uuid, z.literal("unassigned")]).optional(),
    type: z.enum(TASK_TYPES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    // §14: never more than 100 rows at once; a larger ask is refused, not cut.
    limit: z.coerce.number().int().min(1).max(100).default(TASKS_PAGE_SIZE),
  })
  // Asking for one assignee means their tasks, not mine AND theirs (which
  // is nothing, or only mine).
  .transform((q) => (q.assignee ? { ...q, mine: false } : q));
export type TaskListQuery = z.output<typeof taskListQuerySchema>;

// §7 URL shape: ?page=&limit=&filter[...].
export function readTaskParams(sp: URLSearchParams) {
  return {
    mine: sp.get("filter[mine]") ?? undefined,
    assignee: sp.get("filter[assignee]") ?? undefined,
    type: sp.get("filter[type]") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  };
}
